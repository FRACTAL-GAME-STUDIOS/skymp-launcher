'use strict';

// Descargas HTTP(S) con seguimiento de redirecciones y progreso.
// Incluye resolucion de artefactos de GitHub Actions (modo 'github').

const fs = require('fs');
const https = require('https');
const { URL } = require('url');

const UA = 'skymp-launcher/0.1 (+https://github.com/skyrim-multiplayer/skymp)';

// Descarga url -> destPath. onProgress(received, total|null).
// Sigue 30x. Por seguridad, elimina la cabecera Authorization si cambia de host.
function download(url, destPath, onProgress, headers = {}, _redirects = 0) {
  return new Promise((resolve, reject) => {
    if (_redirects > 10) return reject(new Error('Demasiadas redirecciones'));

    const u = new URL(url);
    const reqHeaders = { 'User-Agent': UA, ...headers };

    const req = https.get(
      url,
      { headers: reqHeaders },
      (res) => {
        // Redirecciones.
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          const nextHost = new URL(next).host;
          const fwdHeaders = { ...headers };
          // No reenviar el token a otro host (ej: GitHub -> Azure Blob).
          if (nextHost !== u.host) delete fwdHeaders.Authorization;
          return resolve(download(next, destPath, onProgress, fwdHeaders, _redirects + 1));
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(
            new Error(`HTTP ${res.statusCode} al descargar ${url}`)
          );
        }

        const total = parseInt(res.headers['content-length'] || '0', 10) || null;
        let received = 0;
        const file = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress) onProgress(received, total);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve({ destPath, total, received })));
        file.on('error', (err) => {
          fs.unlink(destPath, () => reject(err));
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('Timeout de descarga')));
  });
}

// GET JSON sencillo (para la API de GitHub).
function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json', ...headers } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} en ${url}`));
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

// Resuelve el artefacto mas reciente de un repo. Requiere token (actions:read).
// Devuelve { downloadUrl, headers } para pasar a download().
async function resolveGithubArtifact({ repo, artifactName, token }) {
  if (!token) {
    throw new Error(
      'El modo "github" necesita un token (PAT con scope actions:read). ' +
        'Usa el modo "url" (nightly.link) si no quieres token.'
    );
  }
  const auth = { Authorization: `Bearer ${token}` };
  const api = `https://api.github.com/repos/${repo}/actions/artifacts?per_page=100`;
  const json = await getJson(api, auth);
  const matches = (json.artifacts || [])
    .filter((a) => a.name === artifactName && !a.expired)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!matches.length) {
    throw new Error(`No se encontro un artefacto vigente llamado "${artifactName}" en ${repo}`);
  }
  return { downloadUrl: matches[0].archive_download_url, headers: auth };
}

module.exports = { download, getJson, resolveGithubArtifact };
