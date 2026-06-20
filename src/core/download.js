'use strict';

// Descargas HTTP(S) con seguimiento de redirecciones y progreso.

const fs = require('fs');
const https = require('https');
const { URL } = require('url');

const UA = 'skymp-launcher/0.1 (+https://github.com/skyrim-multiplayer/skymp)';

// Descarga url -> destPath. onProgress(received, total|null). Sigue 30x.
function download(url, destPath, onProgress, _redirects = 0) {
  return new Promise((resolve, reject) => {
    if (_redirects > 10) return reject(new Error('Demasiadas redirecciones'));

    const req = https.get(
      url,
      { headers: { 'User-Agent': UA } },
      (res) => {
        // Redirecciones.
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return resolve(download(next, destPath, onProgress, _redirects + 1));
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(
            new Error(`HTTP ${res.statusCode} al descargar ${url}`)
          );
        }

        const total = parseInt(res.headers['content-length'] || '0', 10) || null;
        const etag = res.headers['etag'] || null;
        const lastModified = res.headers['last-modified'] || null;
        let received = 0;
        const file = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress) onProgress(received, total);
        });
        res.pipe(file);
        file.on('finish', () =>
          file.close(() => resolve({ destPath, total, received, etag, lastModified }))
        );
        file.on('error', (err) => {
          fs.unlink(destPath, () => reject(err));
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('Timeout de descarga')));
  });
}

// Comprueba una URL sin descargar el cuerpo: solo lee las cabeceras (etag /
// last-modified / content-length) y cierra la conexion. Sirve para detectar
// si un recurso remoto ha cambiado desde la ultima instalacion, sin gastar
// ancho de banda en volver a descargarlo entero.
function probe(url, _redirects = 0) {
  return new Promise((resolve, reject) => {
    if (_redirects > 10) return reject(new Error('Demasiadas redirecciones'));

    const req = https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(probe(next, _redirects + 1));
      }

      res.destroy();
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} al comprobar ${url}`));
      }
      resolve({
        url,
        etag: res.headers['etag'] || null,
        lastModified: res.headers['last-modified'] || null,
        contentLength: res.headers['content-length'] || null,
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Timeout al comprobar actualizaciones')));
  });
}

module.exports = { download, probe };
