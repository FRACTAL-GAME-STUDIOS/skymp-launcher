'use strict';

// CLI para probar el flujo completo sin la UI.
//
//   node cli.js detect
//   node cli.js servers
//   node cli.js install --dest "D:\\SkyMPClient\\Skyrim" [--source "D:\\ruta\\Skyrim"]
//   node cli.js play <serverId> --dest "D:\\SkyMPClient\\Skyrim"

const fs = require('fs');
const path = require('path');

const steam = require('./src/core/steam');
const settings = require('./src/core/settings');
const installer = require('./src/core/installer');
const { launchGame } = require('./src/core/launch');

const CONFIG_FILE = path.join(__dirname, 'config', 'config.json');
const SERVERS_FILE = path.join(__dirname, 'config', 'servers.json');

function getArg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function loadConfig() {
  return settings.readJson(CONFIG_FILE, {});
}

function human(bytes) {
  if (!bytes) return '?';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < u.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(1)} ${u[i]}`;
}

async function main() {
  const cmd = process.argv[2];

  if (cmd === 'detect') {
    const info = steam.inspect();
    console.log(JSON.stringify(info, null, 2));
    if (info.found && info.version) {
      const req = loadConfig().requiredGameVersion;
      if (req && !info.version.startsWith(req)) {
        console.warn(`\n[AVISO] Version ${info.version} != requerida ${req}`);
      } else {
        console.log('\n[OK] Version correcta.');
      }
    }
    return;
  }

  if (cmd === 'servers') {
    console.log(JSON.stringify(settings.loadServers(SERVERS_FILE), null, 2));
    return;
  }

  if (cmd === 'install') {
    const config = loadConfig();
    let source = getArg('source');
    if (!source) {
      const found = steam.findSkyrim();
      if (!found) throw new Error('No se detecto Skyrim. Usa --source para indicarlo.');
      source = found.gameDir;
      console.log('Skyrim detectado en:', source);
    }
    const dest = getArg('dest');
    if (!dest) throw new Error('Falta --dest (carpeta destino de la instalacion).');

    let lastStage = '';
    await installer.install({
      gameDir: source,
      dest,
      config,
      onStage(stage, info) {
        if (stage !== lastStage) {
          lastStage = stage;
          process.stdout.write(`\n[${stage}] ${info.message || ''}`);
        }
        if (info.copiedBytes != null) {
          process.stdout.write(`\r[clone] ${human(info.copiedBytes)} / ${human(info.totalBytes)} (${info.copiedFiles}/${info.totalFiles})   `);
        } else if (info.received != null) {
          process.stdout.write(`\r[${stage}] ${human(info.received)}${info.total ? ' / ' + human(info.total) : ''}   `);
        } else if (typeof info.percent === 'number') {
          process.stdout.write(`\r[${stage}] ${info.percent}%   `);
        } else if (info.done != null) {
          process.stdout.write(`\r[${stage}] ${info.done}/${info.total}   `);
        }
        if (info.versionWarning) console.warn(`\n[AVISO] ${info.versionWarning}`);
      },
    });
    console.log('\nListo. Usa: node cli.js play <serverId> --dest "' + dest + '"');
    return;
  }

  if (cmd === 'play') {
    const serverId = process.argv[3];
    const dest = getArg('dest');
    if (!serverId || !dest) throw new Error('Uso: node cli.js play <serverId> --dest "<carpeta>"');
    const server = settings.loadServers(SERVERS_FILE).find((s) => s.id === serverId);
    if (!server) throw new Error(`Servidor "${serverId}" no encontrado en servers.json`);
    if (!installer.checkInstalled(dest)) {
      throw new Error(`No parece haber una instalacion de SkyMP en ${dest}. Ejecuta install primero.`);
    }
    const file = settings.writeClientSettings(dest, server);
    console.log('Config escrita en:', file, '->', server.ip + ':' + server.port);
    launchGame(dest);
    console.log('Lanzando', server.name, '...');
    return;
  }

  console.log(`Comandos:
  node cli.js detect
  node cli.js servers
  node cli.js install --dest "D:\\SkyMPClient\\Skyrim" [--source "<ruta Skyrim>"]
  node cli.js play <serverId> --dest "D:\\SkyMPClient\\Skyrim"`);
}

main().catch((e) => {
  console.error('\nERROR:', e.message);
  process.exit(1);
});
