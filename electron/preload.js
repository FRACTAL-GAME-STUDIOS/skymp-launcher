'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  detect: () => ipcRenderer.invoke('detect'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  checkInstalled: () => ipcRenderer.invoke('check-installed'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openInstallDir: () => ipcRenderer.invoke('open-install-dir'),
  chooseInstallDir: () => ipcRenderer.invoke('choose-install-dir'),
  getServers: () => ipcRenderer.invoke('get-servers'),
  pingServer: (s) => ipcRenderer.invoke('ping-server', s),
  saveServer: (s) => ipcRenderer.invoke('save-server', s),
  deleteServer: (id) => ipcRenderer.invoke('delete-server', id),
  install: () => ipcRenderer.invoke('install'),
  installFront: () => ipcRenderer.invoke('install-front'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  updateContent: (targets) => ipcRenderer.invoke('update-content', targets),
  play: (opts) => ipcRenderer.invoke('play', opts),
  onInstallProgress: (cb) =>
    ipcRenderer.on('install-progress', (_e, payload) => cb(payload)),
  onUpdateProgress: (cb) =>
    ipcRenderer.on('update-progress', (_e, payload) => cb(payload)),
  onServersChanged: (cb) =>
    ipcRenderer.on('servers-changed', (_e, servers) => cb(servers)),
  onConfigChanged: (cb) =>
    ipcRenderer.on('config-changed', (_e, config) => cb(config)),
  gameRunning: () => ipcRenderer.invoke('game-running'),
  killGame: () => ipcRenderer.invoke('kill-game'),
});
