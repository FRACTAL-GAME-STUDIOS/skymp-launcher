'use strict';

// Orquestador de la instalacion completa de SkyMP.
// Fases: verify -> clone -> download-skse -> extract-skse -> overlay-skse
//        -> download-pack -> extract-pack -> overlay-pack -> done
//
// Ademas de la instalacion completa (clona Skyrim entero), este modulo
// ofrece checkForUpdates()/updateContent() para refrescar solo el client
// pack / la interfaz / SKSE cuando cambian en el origen, sin tener que
// reinstalar desde cero.

const fs = require('fs');
const os = require('os');
const path = require('path');

const steam = require('./steam');
const { download, probe } = require('./download');
const { extract } = require('./extract');
const { copyDirWithProgress, mergeDir, findDirContaining } = require('./fsutil');

// Comprueba si una carpeta destino ya tiene SkyMP instalado.
function checkInstalled(dest) {
  const must = [
    'skse64_loader.exe',
    path.join('Data', 'SKSE', 'Plugins', 'MpClientPlugin.dll'),
    path.join('Data', 'Platform', 'Plugins', 'skymp5-client.js'),
  ];
  return must.every((m) => fs.existsSync(path.join(dest, m)));
}

// Comprueba si la interfaz de SkyMP (skymp5-front) esta instalada.
function checkFrontInstalled(dest) {
  return fs.existsSync(path.join(dest, 'Data', 'Platform', 'UI', 'index.html'));
}

// --- manifest de versiones -------------------------------------------------
// Guarda, por componente (skse/pack/front), una huella de lo que hay
// instalado (etag/last-modified/content-length del recurso remoto, o
// mtime+size si es un pack local). Permite saber si hay una version mas
// nueva sin volver a descargar nada.

const MANIFEST_REL = '.skymp-launcher-manifest.json';

function manifestPath(dest) {
  return path.join(dest, MANIFEST_REL);
}

function readManifest(dest) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(dest), 'utf8'));
  } catch {
    return {};
  }
}

function writeManifest(dest, manifest) {
  fs.writeFileSync(manifestPath(dest), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

// null si no hay suficiente informacion (el servidor no envia cabeceras de
// cache); en ese caso no podemos saber si hay actualizacion.
function fpFromHeaders({ etag, lastModified, contentLength }) {
  if (!etag && !lastModified && !contentLength) return null;
  return ['h', etag || '', lastModified || '', contentLength || ''].join('|');
}

function fpFromFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const st = fs.statSync(filePath);
  return `f|${st.size}|${st.mtimeMs}`;
}

// Huella remota actual del client pack, sin descargarlo entero.
async function probePackFingerprint(config) {
  const pack = config.clientPack;
  if (!pack) return null;
  if (pack.mode === 'local' && pack.local && pack.local.path) {
    return fpFromFile(pack.local.path);
  }
  if (pack.url) {
    try {
      return fpFromHeaders(await probe(pack.url));
    } catch {
      return null;
    }
  }
  return null;
}

// Huella remota actual de la interfaz (skymp5-front), o null si no esta
// configurada.
async function probeFrontFingerprint(config) {
  const front = config.clientPack && config.clientPack.front;
  if (!front || !front.url) return null;
  try {
    return fpFromHeaders(await probe(front.url));
  } catch {
    return null;
  }
}

async function probeSkseFingerprint(config) {
  if (!config.skse || !config.skse.url) return null;
  try {
    return fpFromHeaders(await probe(config.skse.url));
  } catch {
    return null;
  }
}

// Compara las huellas remotas actuales con las guardadas en el manifest de
// la instalacion. Si un componente no tiene huella conocida todavia (p.ej.
// instalaciones hechas antes de tener este sistema), no se marca como
// actualizable: se limita a registrar la huella actual la siguiente vez que
// se instale/actualice ese componente.
async function checkForUpdates({ dest, config }) {
  const manifest = readManifest(dest);
  const [pack, front, skse] = await Promise.all([
    probePackFingerprint(config),
    probeFrontFingerprint(config),
    probeSkseFingerprint(config),
  ]);

  const componentInfo = (current, known) => ({
    current,
    known: known || null,
    hasUpdate: !!current && !!known && current !== known,
  });

  const result = {
    pack: componentInfo(pack, manifest.pack),
    front: componentInfo(front, manifest.front),
    skse: componentInfo(skse, manifest.skse),
  };
  result.any = result.pack.hasUpdate || result.front.hasUpdate || result.skse.hasUpdate;
  return result;
}

// --- pasos compartidos entre instalacion completa y actualizacion ---------

async function installSkse({ dest, config, tmpDir, onStage }) {
  const skse7z = path.join(tmpDir, 'skse.7z');
  onStage('download-skse', { message: 'Descargando SKSE64...' });
  const dl = await download(config.skse.url, skse7z, (received, total) =>
    onStage('download-skse', { received, total })
  );

  const skseOut = path.join(tmpDir, 'skse');
  onStage('extract-skse', { message: 'Extrayendo SKSE...' });
  await extract(skse7z, skseOut, (percent) => onStage('extract-skse', { percent }));

  const skseRoot = findDirContaining(skseOut, 'skse64_loader.exe') || skseOut;
  onStage('overlay-skse', { message: 'Instalando SKSE...' });
  await mergeDir(skseRoot, dest, (p) => onStage('overlay-skse', p));

  return fpFromHeaders({ etag: dl.etag, lastModified: dl.lastModified, contentLength: dl.total });
}

async function installPack({ dest, config, tmpDir, onStage }) {
  const pack = config.clientPack;
  let packZip;
  let fingerprint = null;

  if (pack.mode === 'local' && pack.local && pack.local.path) {
    packZip = pack.local.path;
    onStage('download-pack', { message: `Usando pack local: ${packZip}` });
    if (!fs.existsSync(packZip)) throw new Error(`No existe el pack local: ${packZip}`);
    fingerprint = fpFromFile(packZip);
  } else {
    // modo 'url' (nightly.link u hosting propio)
    packZip = path.join(tmpDir, 'pack.zip');
    onStage('download-pack', { message: 'Descargando client pack...' });
    const dl = await download(pack.url, packZip, (r, t) => onStage('download-pack', { received: r, total: t }));
    fingerprint = fpFromHeaders({ etag: dl.etag, lastModified: dl.lastModified, contentLength: dl.total });
  }

  const packOut = path.join(tmpDir, 'pack');
  onStage('extract-pack', { message: 'Extrayendo client pack...' });
  await extract(packZip, packOut, (percent) => onStage('extract-pack', { percent }));

  const sub = (pack.clientDataSubpath || 'client/Data').split('/');
  let clientData = path.join(packOut, ...sub);
  if (!fs.existsSync(clientData)) {
    // Por si el zip no anida en client/: buscar la carpeta Data.
    const found = findDirContaining(packOut, 'skymp5-client.js');
    if (found) clientData = found; // .../Platform/Plugins -> subimos 2 niveles
    // Subir hasta el Data
    while (clientData && path.basename(clientData) !== 'Data' && path.dirname(clientData) !== clientData) {
      clientData = path.dirname(clientData);
    }
  }
  if (!clientData || !fs.existsSync(clientData)) {
    throw new Error('No se encontro client/Data dentro del pack descargado.');
  }
  onStage('overlay-pack', { message: 'Instalando cliente SkyMP...' });
  await mergeDir(clientData, path.join(dest, 'Data'), (p) => onStage('overlay-pack', p));

  return fingerprint;
}

// Descarga y superpone el paquete pre-compilado de skymp5-front sobre
// <dest>/Data/Platform/UI. Si no hay URL configurada, no hace nada.
async function installFrontPack({ dest, config, tmpDir, onStage }) {
  const front = config.clientPack && config.clientPack.front;
  if (!front || !front.url) return { skipped: true, fingerprint: null };

  const frontZip = path.join(tmpDir, 'front.zip');
  onStage('download-front', { message: 'Descargando interfaz SkyMP (skymp5-front)...' });
  const dl = await download(front.url, frontZip, (received, total) =>
    onStage('download-front', { received, total })
  );

  const frontOut = path.join(tmpDir, 'front');
  onStage('extract-front', { message: 'Extrayendo interfaz SkyMP...' });
  await extract(frontZip, frontOut, (percent) => onStage('extract-front', { percent }));

  const subFront = (front.subpath || 'client/Data/Platform/UI').split('/');
  let frontData = path.join(frontOut, ...subFront);
  if (!fs.existsSync(frontData)) {
    frontData = findDirContaining(frontOut, 'index.html') || frontData;
  }
  if (!fs.existsSync(frontData)) {
    throw new Error('No se encontro index.html dentro del paquete de skymp5-front.');
  }
  onStage('overlay-front', { message: 'Instalando interfaz SkyMP...' });
  await mergeDir(frontData, path.join(dest, 'Data', 'Platform', 'UI'), (p) => onStage('overlay-front', p));

  const fingerprint = fpFromHeaders({ etag: dl.etag, lastModified: dl.lastModified, contentLength: dl.total });
  return { skipped: false, fingerprint };
}

// Instala (o actualiza) solo la interfaz skymp5-front sobre una instalacion
// de SkyMP ya existente.
async function installFront(opts) {
  const { dest, config } = opts;
  const onStage = opts.onStage || (() => {});
  const tmpDir =
    opts.tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'skymp-front-'));
  fs.mkdirSync(tmpDir, { recursive: true });

  const result = await installFrontPack({ dest, config, tmpDir, onStage });
  if (result.skipped) {
    throw new Error('La interfaz de SkyMP (skymp5-front) no esta configurada (clientPack.front.url vacio).');
  }
  const manifest = readManifest(dest);
  manifest.front = result.fingerprint;
  writeManifest(dest, manifest);
  onStage('done', { message: 'Interfaz instalada.' });
  return { dest };
}

// opts:
//   gameDir         (origen: instalacion de Steam)
//   dest            (carpeta destino del clon)
//   config          (objeto config.json)
//   tmpDir          (opcional)
//   onStage(stage, info)   info segun fase: {percent} | {copiedBytes,totalBytes} | {done,total} | {message}
async function install(opts) {
  const { gameDir, dest, config } = opts;
  const onStage = opts.onStage || (() => {});
  const tmpDir =
    opts.tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'skymp-'));
  fs.mkdirSync(tmpDir, { recursive: true });

  // 1. Verificar origen y version --------------------------------------
  onStage('verify', { message: 'Verificando instalacion de Skyrim...' });
  if (!fs.existsSync(path.join(gameDir, steam.SKYRIM_EXE))) {
    throw new Error(`No se encuentra ${steam.SKYRIM_EXE} en ${gameDir}`);
  }
  const version = steam.getGameVersion(gameDir);
  const required = config.requiredGameVersion;
  let versionWarning = null;
  if (version && required && !version.startsWith(required)) {
    versionWarning =
      `La version detectada (${version}) no coincide con la requerida (${required}). ` +
      `SKSE 2.2.6 es para ${required}; el juego podria no arrancar.`;
  }
  onStage('verify', { message: 'OK', version, versionWarning });

  // 2. Clonar Skyrim ----------------------------------------------------
  onStage('clone', { message: 'Clonando Skyrim (puede tardar varios minutos)...' });
  fs.mkdirSync(dest, { recursive: true });
  await copyDirWithProgress(gameDir, dest, (p) => onStage('clone', p));

  // 3-5. Descargar, extraer y superponer SKSE ----------------------------
  const skseFingerprint = await installSkse({ dest, config, tmpDir, onStage });

  // 6-8. Obtener, extraer y superponer el client pack --------------------
  const packFingerprint = await installPack({ dest, config, tmpDir, onStage });

  // 9. Interfaz SkyMP (skymp5-front), opcional ---------------------------
  const frontResult = await installFrontPack({ dest, config, tmpDir, onStage });

  writeManifest(dest, {
    skse: skseFingerprint,
    pack: packFingerprint,
    front: frontResult.skipped ? null : frontResult.fingerprint,
  });

  onStage('done', { message: 'Instalacion completada.', versionWarning });
  return { dest, versionWarning };
}

// Actualiza solo los componentes indicados en `targets` (p.ej. { pack: true,
// front: true, skse: false }) sobre una instalacion ya existente, sin volver
// a clonar Skyrim. Pensado para usarse despues de checkForUpdates().
async function updateContent(opts) {
  const { dest, config, targets = {} } = opts;
  const onStage = opts.onStage || (() => {});
  const tmpDir =
    opts.tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'skymp-update-'));
  fs.mkdirSync(tmpDir, { recursive: true });

  if (!checkInstalled(dest)) {
    throw new Error('SkyMP no esta instalado en esta carpeta.');
  }

  const manifest = readManifest(dest);

  if (targets.skse) {
    manifest.skse = await installSkse({ dest, config, tmpDir, onStage });
  }
  if (targets.pack) {
    manifest.pack = await installPack({ dest, config, tmpDir, onStage });
  }
  if (targets.front) {
    const result = await installFrontPack({ dest, config, tmpDir, onStage });
    if (!result.skipped) manifest.front = result.fingerprint;
  }

  writeManifest(dest, manifest);
  onStage('done', { message: 'Actualizacion completada.' });
  return { dest };
}

module.exports = {
  install,
  installFront,
  updateContent,
  checkForUpdates,
  checkInstalled,
  checkFrontInstalled,
};
