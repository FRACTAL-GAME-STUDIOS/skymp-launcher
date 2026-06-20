'use strict';

// Extraccion de archivos .7z y .zip usando el binario 7za empaquetado.

const Seven = require('node-7z');
const sevenBin = require('7zip-bin');
const fs = require('fs');

// 7zip-bin no sabe que esta empaquetado dentro de app.asar: su ruta exportada
// apunta dentro del archivo asar, pero un binario ahi no se puede ejecutar
// (no es un fichero real). electron-builder lo desempaqueta en
// app.asar.unpacked (ver "asarUnpack" en package.json); aqui redirigimos la
// ruta para que apunte al binario real cuando la app esta empaquetada.
function resolve7za() {
  const p = sevenBin.path7za;
  return p.includes('app.asar') ? p.replace('app.asar', 'app.asar.unpacked') : p;
}

// extract(archivePath, destDir, onProgress) -> Promise
// onProgress(percent 0..100)
function extract(archivePath, destDir, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const stream = Seven.extractFull(archivePath, destDir, {
      $bin: resolve7za(),
      $progress: true,
    });
    stream.on('progress', (p) => {
      if (onProgress && typeof p.percent === 'number') onProgress(p.percent);
    });
    stream.on('end', () => resolve(destDir));
    stream.on('error', reject);
  });
}

module.exports = { extract };
