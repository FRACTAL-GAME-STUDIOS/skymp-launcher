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

call npm start
pause
