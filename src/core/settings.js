'use strict';

// Gestion de la config de cliente (skymp5-client-settings.txt) y de servidores.

const fs = require('fs');
const path = require('path');
const cryptoUtil = require('./crypto');

const ENC_PREFIX = 'enc:';

const CLIENT_SETTINGS_REL = path.join(
  'Data',
  'Platform',
  'Plugins',
  'skymp5-client-settings.txt'
);

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// Escribe la config de cliente apuntando a un servidor. El archivo es JSON
// (aunque la extension sea .txt). Mantenemos el schema completo del build
// oficial. IMPORTANTE: server-master-key se deja en null por defecto porque
// asi era la config verificada-funcionando en offlineMode. El masterKey del
// servidor solo se envia si server.sendMasterKey === true (util cuando se
// pase a offlineMode:false).
//
// profileId identifica el personaje del jugador en el servidor (offlineMode).
// Es el AccountID de Steam (32 bits, derivado del SteamID64), asi que es
// estable entre PCs para la misma cuenta; si no se puede determinar (sin
// Steam), se usa 1 como antes.
function writeClientSettings(gameDir, server, profileId) {
  const file = path.join(gameDir, CLIENT_SETTINGS_REL);
  const settings = {
    gameData: { profileId: profileId || 1 },
    master: '',
    'server-ip': server.ip,
    'server-master-key': server.sendMasterKey ? server.masterKey || null : null,
    'server-port': server.port || 7777,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
  return file;
}

// --- servidores ----------------------------------------------------------

// ip/port se guardan cifrados en servers.json (ver crypto.js). encodeField/
// decodeField son transparentes: si el valor no esta cifrado (ficheros
// antiguos), se devuelve tal cual.
function encodeField(value) {
  return ENC_PREFIX + cryptoUtil.encrypt(String(value));
}

function decodeField(value) {
  if (typeof value === 'string' && value.startsWith(ENC_PREFIX)) {
    return cryptoUtil.decrypt(value.slice(ENC_PREFIX.length));
  }
  return value;
}

function loadServers(serversFile) {
  const data = readJson(serversFile, { servers: [] });
  const servers = Array.isArray(data.servers) ? data.servers : [];
  return servers.map((s) => ({
    ...s,
    ip: decodeField(s.ip),
    port: Number(decodeField(s.port)),
  }));
}

function saveServers(serversFile, servers) {
  const encoded = servers.map((s) => ({
    ...s,
    ip: encodeField(s.ip),
    port: encodeField(s.port),
  }));
  writeJson(serversFile, { servers: encoded });
}

function upsertServer(serversFile, server) {
  const servers = loadServers(serversFile);
  const i = servers.findIndex((s) => s.id === server.id);
  if (i >= 0) servers[i] = server;
  else servers.push(server);
  saveServers(serversFile, servers);
  return servers;
}

function removeServer(serversFile, id) {
  const servers = loadServers(serversFile).filter((s) => s.id !== id);
  saveServers(serversFile, servers);
  return servers;
}

module.exports = {
  CLIENT_SETTINGS_REL,
  readJson,
  writeJson,
  writeClientSettings,
  loadServers,
  saveServers,
  upsertServer,
  removeServer,
};
