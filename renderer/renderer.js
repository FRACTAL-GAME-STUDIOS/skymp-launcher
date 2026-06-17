'use strict';

const $ = (id) => document.getElementById(id);
const state = {
  steamFound: false,
  gameFound: false,
  version: null,
  versionOk: true,
  installed: false,
  installDir: 'C:\\FractalGameStudios\\Skyrim',
  requiredVersion: null,
  servers: [],
  frontInstalled: false,
  frontConfigured: false,
  updateInfo: null,
};

const STEAM_URL = 'https://store.steampowered.com/about/';
const SKYRIM_URL = 'https://store.steampowered.com/app/489830/';

function human(b) {
  if (!b) return '?';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(1) + ' ' + u[i];
}

function setFoot(msg, kind) {
  const el = $('foot-info');
  el.textContent = msg || '';
  el.style.color = kind === 'err' ? 'var(--err)' : kind === 'ok' ? 'var(--ok)' : 'var(--muted)';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// --- Vistas --------------------------------------------------------------
function showView(name) {
  if (name === 'servers' && !state.installed) name = 'setup';
  $('view-servers').hidden = name !== 'servers';
  $('view-setup').hidden = name !== 'setup';
  $('btn-settings').hidden = !state.installed;
  if (state.installed) {
    $('btn-settings').classList.toggle('active', !$('view-setup').hidden);
  }
}

function refreshMastheadState() {
  const pill = $('install-state');
  pill.hidden = false;
  if (state.installed) {
    pill.textContent = '● Instalado';
    pill.className = 'pill ok';
  } else if (!state.gameFound) {
    pill.textContent = '○ Falta Skyrim';
    pill.className = 'pill warn';
  } else {
    pill.textContent = '○ Sin instalar';
    pill.className = 'pill muted';
  }
}

// --- Onboarding / detección ----------------------------------------------
function setReq(prefix, dotClass, statusText, rowClass) {
  $(prefix + '-dot').className = 'req-dot ' + dotClass;
  $(prefix + '-status').textContent = statusText;
  const row = $('req-' + (prefix === 'skymp' ? 'skymp' : prefix));
  row.className = 'req' + (rowClass ? ' ' + rowClass : '');
}

async function detect() {
  setReq('steam', 'checking', 'Buscando…', '');
  setReq('game', 'checking', 'Buscando…', '');
  $('steam-action').hidden = true;
  $('game-action').hidden = true;
  $('version-warn').hidden = true;

  const info = await window.api.detect();
  state.steamFound = !!info.steamPath;
  state.gameFound = !!info.gameDir;
  state.version = info.version;
  state.versionOk = !(state.requiredVersion && info.version && !info.version.startsWith(state.requiredVersion));

  if (state.steamFound) {
    setReq('steam', 'ok', 'Detectado', 'ok');
  } else {
    setReq('steam', 'err', 'No encontrado — necesitas Steam', 'err');
    $('steam-action').hidden = false;
  }

  if (state.gameFound) {
    if (state.versionOk) {
      setReq('game', 'ok', `Detectado · v${state.version || '?'}`, 'ok');
    } else {
      setReq('game', 'warn', `v${state.version} · SkyMP necesita ${state.requiredVersion}`, 'err');
      const w = $('version-warn');
      w.hidden = false;
      w.textContent = `Tu Skyrim es v${state.version}, pero SkyMP necesita v${state.requiredVersion}. Puede que no arranque.`;
    }
  } else {
    setReq('game', 'err', 'No encontrado — instálalo en Steam', 'err');
    $('game-action').hidden = false;
  }

  if (state.installed) setReq('skymp', 'ok', 'Instalado', 'ok');
  else setReq('skymp', '', 'Sin instalar', '');

  if (state.installed) {
    $('setup-title').textContent = 'Todo listo';
    $('setup-lead').textContent = 'SkyMP está instalado. Puedes reinstalar o actualizar cuando quieras.';
    $('btn-install').textContent = 'Reinstalar / Actualizar';
  } else if (!state.gameFound) {
    $('setup-title').textContent = 'Falta Skyrim';
    $('setup-lead').textContent = 'Necesitas Skyrim Special Edition en Steam antes de instalar SkyMP.';
    $('btn-install').textContent = 'Instalar SkyMP';
  } else {
    $('setup-title').textContent = 'Preparemos tu SkyMP';
    $('setup-lead').textContent = 'Un clic y dejamos tu Skyrim listo para el multijugador.';
    $('btn-install').textContent = 'Instalar SkyMP';
  }

  $('btn-install').disabled = !state.gameFound;
  refreshMastheadState();
  refreshFrontReq();
}

// --- Interfaz SkyMP (skymp5-front) ----------------------------------------
function refreshFrontReq() {
  const row = $('req-front');
  if (!state.frontConfigured) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  if (state.frontInstalled) {
    setReq('front', 'ok', 'Instalado', 'ok');
    $('front-action').hidden = true;
  } else {
    setReq('front', 'err', 'Sin instalar', 'err');
    $('front-action').hidden = false;
  }
}

// --- Carpeta de instalación -----------------------------------------------
async function changeInstallDir() {
  const res = await window.api.chooseInstallDir();
  if (!res.ok) return;

  const status = await window.api.getStatus();
  state.installDir = status.installDir;
  state.installed = status.installed;
  state.frontInstalled = status.frontInstalled;
  state.frontConfigured = status.frontConfigured;
  $('install-path').textContent = status.installDir;
  $('btn-open-dir').hidden = !status.installed;

  refreshMastheadState();
  await detect();
  if (state.installed) await loadServers();
  showView(state.installed ? 'servers' : 'setup');
  setFoot('Carpeta de instalación actualizada.', 'ok');
}

async function installFrontUI() {
  $('front-action').disabled = true;
  $('progress-wrap').hidden = false;
  $('bar').style.width = '0%';
  setFoot('Instalando interfaz SkyMP…');
  const res = await window.api.installFront();
  if (res.ok) {
    $('bar').style.width = '100%';
    $('stage-label').textContent = 'Interfaz instalada.';
    setFoot('Interfaz SkyMP instalada.', 'ok');
    state.frontInstalled = true;
    refreshFrontReq();
    await checkUpdates();
  } else {
    setFoot('Error: ' + res.error, 'err');
    $('stage-label').textContent = 'Fallo al instalar la interfaz.';
  }
  $('front-action').disabled = false;
}

// --- Instalación ---------------------------------------------------------

// Pinta el progreso de una fase (instalacion o actualizacion) en la barra y
// etiqueta indicadas. Comun a install-progress y update-progress, que llevan
// la misma forma de payload pero alimentan barras distintas.
function renderProgressInto(barEl, labelEl, stage, info) {
  let label = stage;
  if (info.message) label = info.message;

  if (info.copiedBytes != null) {
    const pct = info.totalBytes ? Math.round((info.copiedBytes / info.totalBytes) * 100) : 0;
    barEl.style.width = pct + '%';
    label = `Clonando Skyrim · ${human(info.copiedBytes)} / ${human(info.totalBytes)} (${pct}%)`;
  } else if (info.received != null) {
    const pct = info.total ? Math.round((info.received / info.total) * 100) : 0;
    if (info.total) barEl.style.width = pct + '%';
    label = `Descargando · ${human(info.received)}${info.total ? ' / ' + human(info.total) : ''}`;
  } else if (typeof info.percent === 'number') {
    barEl.style.width = info.percent + '%';
    label = `${info.message || 'Extrayendo'} · ${info.percent}%`;
  } else if (info.done != null) {
    const pct = info.total ? Math.round((info.done / info.total) * 100) : 0;
    barEl.style.width = pct + '%';
    label = `${info.message || 'Copiando'} · ${info.done}/${info.total}`;
  }
  labelEl.textContent = label;
}

window.api.onInstallProgress(({ stage, info }) => {
  $('progress-wrap').hidden = false;
  renderProgressInto($('bar'), $('stage-label'), stage, info);
  if (info.versionWarning) setFoot(info.versionWarning, 'err');
});

// --- Actualización de contenido (sin reinstalar) --------------------------
window.api.onUpdateProgress(({ stage, info }) => {
  $('update-progress-wrap').hidden = false;
  renderProgressInto($('update-bar'), $('update-stage-label'), stage, info);
});

async function checkUpdates() {
  if (!state.installed) return;
  const res = await window.api.checkUpdate();
  if (!res.ok) return;
  state.updateInfo = res;
  const banner = $('update-banner');
  if (!res.any) {
    banner.hidden = true;
    return;
  }
  const parts = [];
  if (res.pack && res.pack.hasUpdate) parts.push('cliente');
  if (res.front && res.front.hasUpdate) parts.push('interfaz');
  if (res.skse && res.skse.hasUpdate) parts.push('SKSE');
  $('update-banner-text').textContent = `Actualización disponible (${parts.join(', ')}).`;
  banner.hidden = false;
}

async function doUpdateContent() {
  if (!state.updateInfo) return;
  const targets = {
    pack: !!(state.updateInfo.pack && state.updateInfo.pack.hasUpdate),
    front: !!(state.updateInfo.front && state.updateInfo.front.hasUpdate),
    skse: !!(state.updateInfo.skse && state.updateInfo.skse.hasUpdate),
  };
  $('btn-update-content').disabled = true;
  $('update-progress-wrap').hidden = false;
  $('update-bar').style.width = '0%';
  setFoot('Actualizando contenido…');

  const res = await window.api.updateContent(targets);
  if (res.ok) {
    $('update-bar').style.width = '100%';
    $('update-stage-label').textContent = 'Actualización completada.';
    setFoot('Contenido actualizado.', 'ok');
    $('update-banner').hidden = true;
    state.updateInfo = null;
  } else {
    setFoot('Error: ' + res.error, 'err');
    $('update-stage-label').textContent = 'Falló la actualización.';
  }
  $('btn-update-content').disabled = false;
}

async function doInstall() {
  if (!state.gameFound) return;
  $('btn-install').disabled = true;
  $('progress-wrap').hidden = false;
  $('bar').style.width = '0%';
  setFoot('Instalando…');
  const res = await window.api.install();
  if (res.ok) {
    $('bar').style.width = '100%';
    $('stage-label').textContent = 'Instalación completada.';
    setFoot('¡Listo para jugar!', 'ok');
    state.installed = await window.api.checkInstalled();
    setReq('skymp', 'ok', 'Instalado', 'ok');
    refreshMastheadState();
    const status = await window.api.getStatus();
    state.frontInstalled = status.frontInstalled;
    state.frontConfigured = status.frontConfigured;
    refreshFrontReq();
    await loadServers();
    await checkUpdates();
    showView('servers');
  } else {
    setFoot('Error: ' + res.error, 'err');
    $('stage-label').textContent = 'Falló la instalación.';
  }
  $('btn-install').disabled = false;
  $('btn-open-dir').hidden = !state.installed;
}

// --- Servidores (vista principal) ----------------------------------------
function initialOf(name) {
  const c = (name || '?').trim()[0] || '?';
  return c.toUpperCase();
}

function renderServers() {
  const grid = $('server-grid');
  grid.innerHTML = '';
  const empty = $('empty-state');

  if (state.servers.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const s of state.servers) {
    const card = document.createElement('article');
    card.className = 'server-card';
    card.dataset.id = s.id;
    card.innerHTML = `
      <div class="server-top">
        <div class="server-emblem">${initialOf(s.name)}</div>
        <div class="server-meta">
          <h3 class="server-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</h3>
          <div class="server-addr${s.hideIp ? ' hidden-ip' : ''}">${s.hideIp ? '● ● ● ● ● ● ●' : escapeHtml(s.ip) + ':' + s.port}</div>
        </div>
      </div>
      <div class="server-status"><span class="dot checking"></span><span class="status-text">Comprobando…</span></div>
      <div class="server-actions">
        <button class="server-play">JUGAR</button>
        <button class="server-del" title="Eliminar servidor">✕</button>
      </div>`;

    card.querySelector('.server-play').onclick = () => play(s.id);
    card.querySelector('.server-del').onclick = (e) => {
      e.stopPropagation();
      deleteServer(s.id, s.name);
    };
    grid.appendChild(card);
  }

  const add = document.createElement('article');
  add.className = 'server-card add';
  add.innerHTML = '<div class="plus">+</div><div>Añadir servidor</div>';
  add.onclick = openModal;
  grid.appendChild(add);

  pingAll();
}

async function pingAll() {
  await Promise.all(state.servers.map(async (s) => {
    const card = document.querySelector(`.server-card[data-id="${CSS.escape(s.id)}"]`);
    if (!card) return;
    const dot = card.querySelector('.dot');
    const txt = card.querySelector('.status-text');
    dot.className = 'dot checking';
    txt.textContent = 'Comprobando…';
    try {
      const res = await window.api.pingServer({ ip: s.ip, pingPort: s.pingPort });
      if (res.online) {
        dot.className = 'dot online';
        txt.textContent = res.ms != null ? `En línea · ${res.ms} ms` : 'En línea';
      } else {
        dot.className = 'dot offline';
        txt.textContent = 'Sin respuesta';
      }
    } catch {
      dot.className = 'dot offline';
      txt.textContent = 'Sin respuesta';
    }
  }));
}

async function loadServers() {
  state.servers = await window.api.getServers();
  renderServers();
}

async function deleteServer(id, name) {
  if (!confirm(`¿Eliminar el servidor "${name}"?`)) return;
  await window.api.deleteServer(id);
  await loadServers();
  setFoot('Servidor eliminado.');
}

// --- Modal añadir servidor -----------------------------------------------
function openModal() {
  $('modal').hidden = false;
  $('f-name').value = '';
  $('f-id').value = '';
  $('f-ip').value = '';
  $('f-port').value = '7777';
  $('f-ping-port').value = '3000';
  $('f-hide-ip').checked = false;
  $('f-key').value = '';
  $('f-name').focus();
}
function closeModal() { $('modal').hidden = true; }

async function saveServer() {
  const server = {
    id: ($('f-id').value || $('f-name').value || 'srv').trim().toLowerCase().replace(/\s+/g, '-'),
    name: $('f-name').value.trim() || 'Servidor',
    ip: $('f-ip').value.trim() || '127.0.0.1',
    port: parseInt($('f-port').value, 10) || 7777,
    pingPort: parseInt($('f-ping-port').value, 10) || 3000,
    hideIp: $('f-hide-ip').checked,
    masterKey: $('f-key').value.trim() || null,
  };
  await window.api.saveServer(server);
  closeModal();
  await loadServers();
  setFoot(`Servidor "${server.name}" guardado.`, 'ok');
}

// --- Jugar + control del proceso -----------------------------------------
let gamePoller = null;

function startGamePoller() {
  $('btn-kill-game').hidden = false;
  clearInterval(gamePoller);
  gamePoller = setInterval(async () => {
    const running = await window.api.gameRunning();
    if (!running) {
      stopGamePoller();
      setFoot('');
    }
  }, 3000);
}

function stopGamePoller() {
  clearInterval(gamePoller);
  gamePoller = null;
  $('btn-kill-game').hidden = true;
}

async function play(serverId) {
  const server = state.servers.find((s) => s.id === serverId);
  setFoot(`Lanzando ${server ? server.name : ''}…`);
  const res = await window.api.play({ serverId });
  if (res.ok) {
    setFoot(`Conectando a ${res.server}…`, 'ok');
    startGamePoller();
  } else {
    setFoot('Error: ' + res.error, 'err');
  }
}

async function killGame() {
  const res = await window.api.killGame();
  if (res.ok) {
    stopGamePoller();
    setFoot('Juego cerrado.', 'ok');
  } else {
    setFoot('No se pudo cerrar el juego.', 'err');
  }
}

// --- Init ----------------------------------------------------------------
async function init() {
  const cfg = await window.api.getConfig();
  state.requiredVersion = cfg.requiredGameVersion || null;

  const status = await window.api.getStatus();
  state.installDir = status.installDir;
  state.installed = status.installed;
  state.frontInstalled = status.frontInstalled;
  state.frontConfigured = status.frontConfigured;
  $('install-path').textContent = status.installDir;
  $('btn-open-dir').hidden = !status.installed;

  $('btn-settings').onclick = () => showView($('view-setup').hidden ? 'setup' : 'servers');
  $('btn-install').onclick = doInstall;
  $('btn-open-dir').onclick = () => window.api.openInstallDir();
  $('btn-change-dir').onclick = changeInstallDir;
  $('steam-action').onclick = () => window.api.openExternal(STEAM_URL);
  $('game-action').onclick = () => window.api.openExternal(SKYRIM_URL);
  $('front-action').onclick = installFrontUI;
  $('btn-kill-game').onclick = killGame;
  $('btn-update-content').onclick = doUpdateContent;

  $('btn-refresh').onclick = pingAll;
  $('btn-add-server').onclick = openModal;
  $('btn-add-empty').onclick = openModal;
  $('btn-cancel-server').onclick = closeModal;
  $('btn-cancel-server-2').onclick = closeModal;
  $('btn-save-server').onclick = saveServer;
  $('modal').onclick = (e) => { if (e.target === $('modal')) closeModal(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  await loadServers();
  await detect();
  await checkUpdates();

  window.api.onServersChanged((servers) => {
    state.servers = servers;
    renderServers();
    setFoot('Servidores recargados.', 'ok');
  });

  window.api.onConfigChanged((cfg) => {
    state.requiredVersion = cfg.requiredGameVersion || null;
    detect();
    checkUpdates();
    setFoot('Configuración recargada.', 'ok');
  });

  // Re-comprobar de fondo por si el dev publica un pack/front nuevo sin
  // tocar config.json (p.ej. un nuevo build de GitHub Actions).
  setInterval(checkUpdates, 5 * 60 * 1000);

  showView(state.installed ? 'servers' : 'setup');
}

init();
