'use strict';

// Deteccion de Steam y de la instalacion de Skyrim Special Edition.
// App ID de Skyrim SE = 489830.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SKYRIM_APP_ID = '489830';
const SKYRIM_DIR_NAME = 'Skyrim Special Edition';
const SKYRIM_EXE = 'SkyrimSE.exe';

// --- helpers de registro (solo Windows) ---------------------------------

function regQuery(keyPath, valueName) {
  try {
    const out = execFileSync('reg', ['query', keyPath, '/v', valueName], {
      encoding: 'utf8',
      windowsHide: true,
    });
    // Lineas tipo:  "    SteamPath    REG_SZ    C:/Program Files (x86)/Steam"
    const line = out.split(/\r?\n/).find((l) => l.includes(valueName));
    if (!line) return null;
    const m = line.match(new RegExp(valueName + '\\s+REG_\\w+\\s+(.+)$'));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// Devuelve la ruta de instalacion de Steam, o null.
function detectSteam() {
  const candidates = [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
    ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
  ];
  for (const [key, val] of candidates) {
    const p = regQuery(key, val);
    if (p) {
      const norm = path.normalize(p);
      if (fs.existsSync(norm)) return norm;
    }
  }
  // Fallback a rutas tipicas.
  for (const p of [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// --- librerias de Steam (libraryfolders.vdf) -----------------------------

function readSteamLibraries(steamPath) {
  const libs = new Set();
  if (steamPath) libs.add(path.normalize(steamPath));

  const vdf = steamPath
    ? path.join(steamPath, 'steamapps', 'libraryfolders.vdf')
    : null;

  if (vdf && fs.existsSync(vdf)) {
    const txt = fs.readFileSync(vdf, 'utf8');
    const re = /"path"\s+"([^"]+)"/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      // En el VDF las barras vienen escapadas ("C:\\Games").
      const clean = path.normalize(m[1].replace(/\\\\/g, '\\'));
      libs.add(clean);
    }
  }
  return [...libs];
}

// --- localizar Skyrim -----------------------------------------------------

// Busca Skyrim SE en todas las librerias. Devuelve { gameDir, library } o null.
function findSkyrim(steamPath) {
  const libs = readSteamLibraries(steamPath || detectSteam());
  for (const lib of libs) {
    const gameDir = path.join(lib, 'steamapps', 'common', SKYRIM_DIR_NAME);
    const exe = path.join(gameDir, SKYRIM_EXE);
    if (fs.existsSync(exe)) {
      return { gameDir, library: lib, exe };
    }
  }
  return null;
}

// Lee la version del ejecutable (ProductVersion) via PowerShell. Ej: "1.6.1170.0".
function getGameVersion(gameDir) {
  const exe = path.join(gameDir, SKYRIM_EXE);
  if (!fs.existsSync(exe)) return null;
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
      ],
      { encoding: 'utf8', windowsHide: true }
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}

// Resumen completo para la UI.
function inspect() {
  const steamPath = detectSteam();
  const skyrim = findSkyrim(steamPath);
  const version = skyrim ? getGameVersion(skyrim.gameDir) : null;
  return {
    steamPath,
    found: !!skyrim,
    gameDir: skyrim ? skyrim.gameDir : null,
    library: skyrim ? skyrim.library : null,
    version,
  };
}

// --- SteamID64 / profileId ------------------------------------------------

// Lee <steamPath>/config/loginusers.vdf y devuelve el SteamID64 (17 digitos)
// de la cuenta marcada como "MostRecent", o la primera que encuentre si
// ninguna lo esta. Devuelve null si no se puede determinar.
function getSteamId64(steamPath) {
  const vdf = steamPath ? path.join(steamPath, 'config', 'loginusers.vdf') : null;
  if (!vdf || !fs.existsSync(vdf)) return null;

  const txt = fs.readFileSync(vdf, 'utf8');
  const blockRe = /"(\d{17})"\s*\{([^{}]*)\}/g;
  let fallback = null;
  let m;
  while ((m = blockRe.exec(txt)) !== null) {
    const [, id, body] = m;
    if (!fallback) fallback = id;
    if (/"MostRecent"\s+"1"/.test(body)) return id;
  }
  return fallback;
}

// SteamID64 = AccountID + 76561197960265728 (offset fijo definido por Valve).
// Restando el offset obtenemos el AccountID ("Steam3 ID"), el numero de 32
// bits que Valve ya asigna de forma unica a cada cuenta. No hay que hashear
// nada: es exacto, sin colisiones, y el mismo en cualquier PC para la misma
// cuenta. Usamos BigInt porque el SteamID64 supera Number.MAX_SAFE_INTEGER.
const STEAM_ID64_BASE = 76561197960265728n;

// Convierte un SteamID64 a su AccountID (entero positivo de 32 bits), o null
// si el valor no es un SteamID64 valido o no cabe en el profileId (int32_t).
function steamId64ToAccountId(steamId64) {
  let id;
  try {
    id = BigInt(steamId64);
  } catch {
    return null;
  }
  const accountId = id - STEAM_ID64_BASE;
  if (accountId <= 0n || accountId > 0x7fffffffn) return null;
  return Number(accountId);
}

// profileId del usuario de Steam actual (su AccountID), o null si no se pudo
// determinar (sin Steam instalado o sin sesiones registradas).
function getProfileId(steamPath) {
  const id64 = getSteamId64(steamPath);
  return id64 ? steamId64ToAccountId(id64) : null;
}

module.exports = {
  SKYRIM_APP_ID,
  SKYRIM_EXE,
  detectSteam,
  readSteamLibraries,
  findSkyrim,
  getGameVersion,
  inspect,
  getSteamId64,
  steamId64ToAccountId,
  getProfileId,
};
