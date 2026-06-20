@echo off
echo.
echo  FRACTAL RP - Subir client-patch a GitHub
echo  ==========================================
echo.

gh --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: GitHub CLI no esta instalado.
    echo  Descargalo en: https://cli.github.com
    pause
    exit /b 1
)

echo  Borrando release anterior si existe...
gh release delete client-v1 --repo FRACTAL-GAME-STUDIOS/skymp-launcher --yes 2>nul

echo  Subiendo release...
gh release create client-v1 "%~dp0client-patch.zip" --repo FRACTAL-GAME-STUDIOS/skymp-launcher --title "FRACTAL RP Client Patch" --notes "Cliente SkyMP para FRACTAL RP."

if errorlevel 1 (
    echo.
    echo  ERROR al subir. Ejecuta: gh auth login
) else (
    echo.
    echo  OK - Subido correctamente.
)
echo.
pause
