'use strict';

// Lanza el juego via SKSE desde la carpeta clonada.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function launchGame(dest) {
  const loader = path.join(dest, 'skse64_loader.exe');
  if (!fs.existsSync(loader)) {
    throw new Error(`No se encuentra skse64_loader.exe en ${dest}. Instala primero.`);
  }
  const child = spawn(loader, [], {
    cwd: dest,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return loader;
}

module.exports = { launchGame };
