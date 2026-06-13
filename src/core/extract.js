'use strict';

// Extraccion de archivos .7z y .zip usando el binario 7za empaquetado.

const Seven = require('node-7z');
const sevenBin = require('7zip-bin');
const fs = require('fs');

// extract(archivePath, destDir, onProgress) -> Promise
// onProgress(percent 0..100)
function extract(archivePath, destDir, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const stream = Seven.extractFull(archivePath, destDir, {
      $bin: sevenBin.path7za,
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
