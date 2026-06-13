# FRACTAL Launcher (SkyMP)

Launcher de 1 clic para **FRACTAL - DEV**. Hace todo el flujo:

1. **Detecta** Steam y tu instalación de Skyrim SE (App ID 489830) recorriendo
   todas las librerías de Steam.
2. **Verifica** la versión (debe ser 1.6.1170; avisa si no).
3. **Clona** Skyrim a la carpeta que tú elijas (no toca la copia de Steam).
4. **Descarga** SKSE64 (silverlock) y el **client pack** de SkyMP.
5. **Superpone** ambos sobre el clon (loader + DLLs + `Data/`).
6. **Selección de servidor**: escribe `skymp5-client-settings.txt` con la IP/puerto
   del servidor elegido y lanza `skse64_loader.exe`.

---

## Requisitos del jugador

- **Skyrim SE / AE 1.6.1170** comprado e instalado en Steam. El launcher **no**
  descarga el juego (no se puede ni se debe); clona la copia legítima del usuario.
- **Node.js 18+** (solo para ejecutar/empaquetar; el jugador final usará el `.exe`).
- Windows (la detección de Steam y el lanzamiento son específicos de Windows).

## Instalar dependencias

```bash
npm install
```

> En entornos con red restringida, Electron descarga su binario en el
> `postinstall`. Si falla, `npm install --ignore-scripts` instala el resto y
> luego puedes obtener Electron aparte.

---

## Probar SIN UI (recomendado primero)

El motor está separado de la interfaz, así que puedes validar todo el flujo por consola:

```bash
node cli.js detect
node cli.js install --dest "D:\SkyMPClient\Skyrim"
node cli.js play fractal-local --dest "D:\SkyMPClient\Skyrim"
```

- `--source "<ruta>"` fuerza la carpeta de Skyrim si la autodetección falla.
- `servers` lista los servidores configurados.

## Ejecutar la UI

```bash
npm start
```

## Empaquetar para distribuir (opcional)

Añade [`electron-builder`](https://www.electron.build/) y un bloque `build` en
`package.json`, luego `npx electron-builder`. Genera un instalador `.exe` que el
jugador ejecuta sin tener Node.

---

## Configuración

### `config/config.json` — de dónde sale el client pack

`clientPack.mode` admite tres vías:

- **`url`** (por defecto): descarga directa de un ZIP. Viene apuntando a
  **nightly.link**, que expone artefactos de repos públicos de GitHub Actions
  **sin token**:
  `https://nightly.link/skyrim-multiplayer/skymp/workflows/pr-windows-flatrim/main/dist.zip`
  > ⚠️ Verifica esa URL la primera vez (nightly.link sirve el último build con
  > éxito de la rama `main`). Lo ideal en producción es **rehospedar tú** el pack
  > en tu VPS y poner aquí esa URL, para fijar la versión que va con tu servidor.
- **`github`**: usa la API de GitHub para coger el último artefacto `dist`.
  **Requiere un PAT** con scope `actions:read` en `clientPack.github.token`.
  Los artefactos de Actions **no se pueden bajar de forma anónima**; por eso
  existe nightly.link.
- **`local`**: usa un `dist.zip` que ya tengas en disco
  (`clientPack.local.path`). Útil para desarrollo con el zip que ya descargaste.

`skse.url` apunta al build AE 2.2.6 (1.6.1170). `requiredGameVersion` controla el
aviso de versión.

### `config/servers.json` — servidores

Lista de `{ id, name, ip, port, masterKey }`. Al elegir uno y dar a **Jugar**,
se escribe la config de cliente con esa IP/puerto.

> `server-master-key` se escribe como `null` por defecto (era así en tu config
> verificada-funcionando en `offlineMode`). Si algún día pasas a
> `offlineMode:false` y necesitas enviarlo, añade `"sendMasterKey": true` al
> servidor en `servers.json`.

---

## Cómo casa con tu servidor

- El pack incluye `client/Data/...` (SkyrimPlatform, MpClientPlugin, skymp5-client.js)
  y se superpone a `<clon>/Data`. Es el mismo `dist.zip` que ya inspeccionamos.
- Para la **primera prueba**, usa el servidor `fractal-local` (127.0.0.1) con el
  servidor Docker en el mismo PC, para descartar VPN/firewall.
- Para que entren otros por Radmin, usa `fractal-radmin` (26.234.13.245).

## Mapa de archivos

```
config/config.json      fuente del pack + SKSE + version requerida
config/servers.json     servidores objetivo
src/core/steam.js       deteccion de Steam/Skyrim + version
src/core/download.js    descargas con redirecciones + artefactos GitHub
src/core/extract.js     extraccion 7z/zip (7za empaquetado)
src/core/fsutil.js      clonado con progreso + overlay
src/core/settings.js    skymp5-client-settings.txt + servidores
src/core/installer.js   orquestador de fases
src/core/launch.js      lanza skse64_loader.exe
cli.js                  flujo completo por consola
electron/main.js        proceso principal + IPC
electron/preload.js     puente seguro
renderer/               UI (HTML/CSS/JS)
```

## Límite que NO se puede saltar

Skyrim es de pago en Steam: el launcher clona la copia del usuario, **no la
descarga**. Todo lo demás (SKSE, client pack, settings, lanzamiento) está
automatizado.
