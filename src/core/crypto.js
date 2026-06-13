'use strict';

// Cifrado simetrico para datos sensibles en servers.json (ip, puerto).
// No protege frente a quien decompile el launcher (la clave va embebida),
// pero evita que la IP/puerto del servidor queden en texto plano en el
// fichero de configuracion.

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const KEY = crypto.createHash('sha256').update('fractal-skymp-launcher').digest();
const IV_LEN = 12;
const TAG_LEN = 16;

function encrypt(value) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(data) {
  const buf = Buffer.from(data, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
