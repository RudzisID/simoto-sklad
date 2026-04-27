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

:: Get current version
for /f %%a in ('node -p "require('./package.json').version"') do set curver=%%a
echo [i] Current version: !curver!

:: Check for updates
echo.
echo [i] Checking for updates...
node -e "https.get('https://api.github.com/repos/RudzisID/simoto-sklad/releases/latest',{headers:{'User-Agent':'SiMOTO'}},r=>{var d='';r.on('data',c=>d+=c);r.on('end',()=>{try{var j=JSON.parse(d);console.log('Latest: '+j.tag_name);if('!curver!'!=j.tag_name.replace('v','')){console.log('New version available!');}else{console.log('You have latest');}}catch(e){console.log('Error');}}).on('error',e=>console.log('No network'))"

:: Start server
echo.
echo [i] Starting server...
start http://localhost:3000
node server.js

echo.
echo [OK] Server stopped
pause
endlocal