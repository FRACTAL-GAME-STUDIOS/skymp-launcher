'use strict';

// Orquestador de la instalacion completa de SkyMP.
// Fases: verify -> clone -> download-skse -> extract-skse -> overlay-skse
//        -> download-pack -> extract-pack -> overlay-pack -> done

const fs = require('fs');
const os = require('os');
const path = require('path');

const steam = require('./steam');
const { download, resolveGithubArtifact } = require('./download');
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

// Descarga y superpone el paquete pre-compilado de skymp5-front sobre
// <dest>/Data/Platform/UI. Si no hay URL configurada, no hace nada.
async function installFrontPack({ dest, config, tmpDir, onStage }) {
  const front = config.clientPack && config.clientPack.front;
  if (!front || !front.url) return { skipped: true };

  const frontZip = path.join(tmpDir, 'front.zip');
  onStage('download-front', { message: 'Descargando interfaz SkyMP (skymp5-front)...' });
  await download(front.url, frontZip, (received, total) =>
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
  return { skipped: false };
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

  // 3. Descargar SKSE ---------------------------------------------------
  const skse7z = path.join(tmpDir, 'skse.7z');
  onStage('download-skse', { message: 'Descargando SKSE64...' });
  await download(config.skse.url, skse7z, (received, total) =>
    onStage('download-skse', { received, total })
  );

  // 4. Extraer SKSE -----------------------------------------------------
  const skseOut = path.join(tmpDir, 'skse');
  onStage('extract-skse', { message: 'Extrayendo SKSE...' });
  await extract(skse7z, skseOut, (percent) => onStage('extract-skse', { percent }));

  // 5. Overlay SKSE -> destino (loader + dlls + Data/) ------------------
  const skseRoot = findDirContaining(skseOut, 'skse64_loader.exe') || skseOut;
  onStage('overlay-skse', { message: 'Instalando SKSE...' });
  await mergeDir(skseRoot, dest, (p) => onStage('overlay-skse', p));

  // 6. Obtener el client pack ------------------------------------------
  const pack = config.clientPack;
  let packZip;
  if (pack.mode === 'local' && pack.local && pack.local.path) {
    packZip = pack.local.path;
    onStage('download-pack', { message: `Usando pack local: ${packZip}` });
    if (!fs.existsSync(packZip)) throw new Error(`No existe el pack local: ${packZip}`);
  } else if (pack.mode === 'github') {
    onStage('download-pack', { message: 'Resolviendo artefacto de GitHub...' });
    const { downloadUrl, headers } = await resolveGithubArtifact(pack.github);
    packZip = path.join(tmpDir, 'pack.zip');
    await download(downloadUrl, packZip, (r, t) => onStage('download-pack', { received: r, total: t }), headers);
  } else {
    // modo 'url' (nightly.link u hosting propio)
    packZip = path.join(tmpDir, 'pack.zip');
    onStage('download-pack', { message: 'Descargando client pack...' });
    await download(pack.url, packZip, (r, t) => onStage('download-pack', { received: r, total: t }));
  }

  // 7. Extraer pack -----------------------------------------------------
  const packOut = path.join(tmpDir, 'pack');
  onStage('extract-pack', { message: 'Extrayendo client pack...' });
  await extract(packZip, packOut, (percent) => onStage('extract-pack', { percent }));

  // 8. Overlay pack: <pack>/client/Data -> <dest>/Data ------------------
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

  // 9. Interfaz SkyMP (skymp5-front), opcional ---------------------------
  await installFrontPack({ dest, config, tmpDir, onStage });

  onStage('done', { message: 'Instalacion completada.', versionWarning });
  return { dest, versionWarning };
}

module.exports = { install, installFront, checkInstalled, checkFrontInstalled };
