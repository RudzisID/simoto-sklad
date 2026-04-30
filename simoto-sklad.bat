@echo off
setlocal enabledelayedexpansion
title SiMOTO-Sklad

echo.
echo ===============================================
echo    SiMOTO-Sklad Launcher
echo ===============================================
echo.

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [X] Node.js not found!
    pause
    exit /b 1
)
echo [OK] Node.js found

:: Check dependencies
if not exist "node_modules" (
    echo [!] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [X] npm install failed!
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
) else (
    echo [OK] Dependencies ready
)

:: Check .env
if not exist ".env" (
    echo GH_TOKEN= > .env
    echo [OK] Created .env
)

:: Create logs dir
if not exist "logs" mkdir logs

:: Get current version (reliable method)
node -p "require('./package.json').version" > "%TEMP%\ver.txt" 2>nul
set /p curver=<"%TEMP%\ver.txt"
del "%TEMP%\ver.txt" >nul 2>&1
echo [i] Current version: %curver%

:: Check for updates
echo.
echo [i] Checking for updates...
node scripts/check-update.js %curver% > "%TEMP%\ver_check.txt" 2>&1
if errorlevel 1 (
  echo [X] Update check failed!
) else (
  :: Check if new version available (check-update.js prints "NEW_AVAILABLE=true" if update exists)
  findstr /C:"NEW_AVAILABLE=true" "%TEMP%\ver_check.txt" >nul 2>&1
  if !errorlevel! EQU 0 (
    echo [i] New version available! Updating...
    git pull origin main
    if errorlevel 1 (
      echo [X] Update failed! Check git configuration.
      pause
      exit /b 1
    )
    echo [OK] Updated! Restarting...
    start "" "%~f0"
    exit /b 0
  )
)
del "%TEMP%\ver_check.txt" >nul 2>&1

:: Start server
echo.
echo [i] Starting server...
start http://localhost:3000
node server.js

echo.
echo [OK] Server stopped
pause
endlocal