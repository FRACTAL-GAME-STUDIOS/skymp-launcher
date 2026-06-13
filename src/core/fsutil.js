'use strict';

// Utilidades de ficheros: clonado con progreso y superposicion (overlay).

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Recorre src y devuelve { files: [...], totalBytes }.
async function scan(src) {
  const files = [];
  let totalBytes = 0;
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const st = await fsp.stat(full);
        files.push({ full, rel: path.relative(src, full), size: st.size });
        totalBytes += st.size;
      }
    }
  }
  await walk(src);
  return { files, totalBytes };
}

// Copia src -> dest. onProgress({ copiedBytes, totalBytes, copiedFiles, totalFiles }).
async function copyDirWithProgress(src, dest, onProgress) {
  const { files, totalBytes } = await scan(src);
  let copiedBytes = 0;
  let copiedFiles = 0;
  for (const f of files) {
    const target = path.join(dest, f.rel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(f.full, target);
    copiedBytes += f.size;
    copiedFiles += 1;
    if (onProgress) {
      onProgress({
        copiedBytes,
        totalBytes,
        copiedFiles,
        totalFiles: files.length,
      });
    }
  }
  return { totalFiles: files.length, totalBytes };
}

// Superpone src sobre dest (sobrescribe). No borra lo que ya hubiera en dest.
async function mergeDir(src, dest, onProgress) {
  if (!fs.existsSync(src)) {
    throw new Error(`No existe la carpeta de origen: ${src}`);
  }
  const { files } = await scan(src);
  let done = 0;
  for (const f of files) {
    const target = path.join(dest, f.rel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(f.full, target);
    done += 1;
    if (onProgress) onProgress({ done, total: files.length });
  }
  return files.length;
}

// Busca recursivamente el primer directorio que contenga `marker` (un fichero).
// Util para localizar la carpeta interna de un 7z/zip (ej. skse64_2_02_06/).
function findDirContaining(root, marker) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((e) => e.isFile() && e.name.toLowerCase() === marker.toLowerCase())) {
      return dir;
    }
    for (const e of entries) if (e.isDirectory()) stack.push(path.join(dir, e.name));
  }
  return null;
}

module.exports = { scan, copyDirWithProgress, mergeDir, findDirContaining };
