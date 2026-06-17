@echo off
cd /d "%~dp0"

if not exist "node_modules" (
    echo Instalando dependencias...
    call npm install
    if errorlevel 1 (
        echo.
        echo Error al instalar las dependencias.
        pause
        exit /b 1
    )
)

:: Verifica que el binario de Electron existe de verdad
set ELECTRON_PATH=node_modules\electron\dist\electron.exe
if not exist "%ELECTRON_PATH%" (
    echo Electron no se instalo correctamente. Reinstalando...
    rd /s /q node_modules\electron
    call npm install electron --save-dev
    if errorlevel 1 (
        echo Error al reinstalar Electron.
        pause
        exit /b 1
    )
)

call npm start
pause