'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { exec } = require('child_process');

const steam = require('../src/core/steam');
const settings = require('../src/core/settings');
const installer = require('../src/core/installer');
const { launchGame } = require('../src/core/launch');

// Ruta de instalacion por defecto. El usuario puede cambiarla desde la UI;
// la eleccion se guarda en prefs.json (userData) y prevalece sobre esta.
const DEFAULT_INSTALL_DIR = path.join('C:\\', 'FractalGameStudios', 'Skyrim');

// En desarrollo leemos directamente de config/ del proyecto para que los
// cambios en los JSON sean visibles sin purgar userData.
// En produccion (app empaquetada) usamos userData para poder escribir.
let CONFIG_DIR;
let CONFIG_FILE;
let SERVERS_FILE;
let PREFS_FILE;

function ensureUserConfig() {
  const projectConfig = path.join(__dirname, '..', 'config');
  if (app.isPackaged) {
    CONFIG_DIR = app.getPath('userData');
    CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
    SERVERS_FILE = path.join(CONFIG_DIR, 'servers.json');
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.copyFileSync(path.join(projectConfig, 'config.json'), CONFIG_FILE);
    }
    if (!fs.existsSync(SERVERS_FILE)) {
      fs.copyFileSync(path.join(projectConfig, 'servers.json'), SERVERS_FILE);
    }
  } else {
    // Desarrollo: leer y escribir directamente en config/ del proyecto.
    CONFIG_DIR = projectConfig;
    CONFIG_FILE = path.join(projectConfig, 'config.json');
    SERVERS_FILE = path.join(projectConfig, 'servers.json');
  }
  // Las preferencias locales (p.ej. carpeta de instalacion elegida por el
  // usuario) van siempre en userData, sean cuales sean CONFIG_DIR/dev mode.
  PREFS_FILE = path.join(app.getPath('userData'), 'prefs.json');
}

function loadConfig() {
  return settings.readJson(CONFIG_FILE, {});
}

function loadPrefs() {
  return settings.readJson(PREFS_FILE, {});
}

function savePrefs(prefs) {
  settings.writeJson(PREFS_FILE, prefs);
}

// Carpeta de instalacion activa: la elegida por el usuario, o la de
// por defecto si no ha cambiado nada.
function getInstallDir() {
  const prefs = loadPrefs();
  return prefs.installDir || DEFAULT_INSTALL_DIR;
}

function isInstalled() {
  try {
    return installer.checkInstalled(getInstallDir());
  } catch {
    return false;
  }
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1190,
    height: 740,
    minWidth: 940,
    minHeight: 660,
    backgroundColor: '#0d1117',
    title: 'FRACTAL Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (config && config.enabledDevTools) {
    mainWindow.webContents.openDevTools();
  }
}

// Vigila un archivo y llama a cb como mucho una vez cada `delay` ms.
// fs.watch dispara varios eventos por guardado (rename + change); el debounce
// los colapsa en uno solo.
function watchDebounced(file, delay, cb) {
  let timer = null;
  fs.watch(file, () => {
    clearTimeout(timer);
    timer = setTimeout(cb, delay);
  });
}

function startFileWatchers() {
  watchDebounced(SERVERS_FILE, 200, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('servers-changed', settings.loadServers(SERVERS_FILE));
  });
  watchDebounced(CONFIG_FILE, 200, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('config-changed', loadConfig());
  });
}

app.whenReady().then(() => {
  ensureUserConfig();
  createWindow();
  startFileWatchers();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC ------------------------------------------------------------------

ipcMain.handle('detect', () => steam.inspect());

ipcMain.handle('get-config', () => loadConfig());

// Estado completo que necesita el render para decidir que pantalla mostrar.
ipcMain.handle('get-status', () => {
  const cfg = loadConfig();
  const installDir = getInstallDir();
  return {
    installDir,
    installed: isInstalled(),
    frontInstalled: installer.checkFrontInstalled(installDir),
    frontConfigured: !!(cfg.clientPack && cfg.clientPack.front && cfg.clientPack.front.url),
  };
});

ipcMain.handle('check-installed', () => isInstalled());

ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));

ipcMain.handle('open-install-dir', () => {
  const installDir = getInstallDir();
  fs.mkdirSync(installDir, { recursive: true });
  return shell.openPath(installDir);
});

// Permite al usuario elegir donde se instala/ejecuta SkyMP. La eleccion se
// guarda en prefs.json y pasa a ser la carpeta activa para todo lo demas.
ipcMain.handle('choose-install-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Elige la carpeta de instalación de SkyMP',
    defaultPath: getInstallDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  const prefs = loadPrefs();
  prefs.installDir = result.filePaths[0];
  savePrefs(prefs);
  return { ok: true };
});

ipcMain.handle('get-servers', () => settings.loadServers(SERVERS_FILE));

// Comprobacion de alcanzabilidad via TCP (sondeo visual, no protocolo de juego).
// Usa pingPort del servidor; si no, el pingPort global de config; si no, 3000.
ipcMain.handle('ping-server', (_e, { ip, pingPort }) => {
  const cfg = loadConfig();
  const tcpPort = pingPort || cfg.pingPort || 3000;
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const started = Date.now();
    let done = false;
    const finish = (online) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ online, ms: online ? Date.now() - started : null });
    };
    socket.setTimeout(2500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    try {
      socket.connect(tcpPort, ip);
    } catch {
      finish(false);
    }
  });
});

ipcMain.handle('save-server', (_e, server) => settings.upsertServer(SERVERS_FILE, server));

ipcMain.handle('delete-server', (_e, id) => settings.removeServer(SERVERS_FILE, id));

ipcMain.handle('install', async () => {
  const config = loadConfig();
  try {
    const found = steam.findSkyrim();
    if (!found) throw new Error('No se ha detectado Skyrim. Instálalo en Steam primero.');
    const installDir = getInstallDir();
    fs.mkdirSync(installDir, { recursive: true });
    const result = await installer.install({
      gameDir: found.gameDir,
      dest: installDir,
      config,
      onStage: (stage, info) =>
        mainWindow.webContents.send('install-progress', { stage, info }),
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('install-front', async () => {
  const config = loadConfig();
  try {
    if (!isInstalled()) throw new Error('Primero instala SkyMP.');
    await installer.installFront({
      dest: getInstallDir(),
      config,
      onStage: (stage, info) =>
        mainWindow.webContents.send('install-progress', { stage, info }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('play', (_e, { serverId }) => {
  try {
    const server = settings.loadServers(SERVERS_FILE).find((s) => s.id === serverId);
    if (!server) throw new Error('Servidor no encontrado.');
    if (!isInstalled()) throw new Error('SkyMP no está instalado.');
    const installDir = getInstallDir();
    const profileId = steam.getProfileId(steam.detectSteam());
    settings.writeClientSettings(installDir, server, profileId);
    launchGame(installDir);
    return { ok: true, server: server.name };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- Control del proceso del juego ----------------------------------------

// Comprueba si SkyrimSE.exe está en ejecución.
function isGameRunning() {
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq SkyrimSE.exe" /NH /FO CSV', (err, stdout) => {
      resolve(!err && stdout.includes('SkyrimSE.exe'));
    });
  });
}

ipcMain.handle('game-running', () => isGameRunning());

ipcMain.handle('kill-game', () =>
  new Promise((resolve) => {
    exec('taskkill /F /IM SkyrimSE.exe', (err) => {
      resolve({ ok: !err, error: err ? err.message : null });
    });
  })
);

