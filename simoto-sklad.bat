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
    (
        echo GH_TOKEN=
    ) > .env
    echo [OK] Created .env
)

:: Create logs dir
if not exist "logs" mkdir logs

:: Get current version via Node.js (with error handling)
for /f "delims=" %%a in ('node -e "try{console.log(require('./package.json').version)}catch(e){console.log('ERROR')}"') do set curver=%%a
if "!curver!"=="ERROR" (
    echo [!] Could not read version from package.json
    set curver=unknown
)
echo [i] Current version: !curver!

:: Check for updates via Node.js
echo.
echo [i] Checking for updates...
node -e "try{const https=require('https');https.get('https://api.github.com/repos/RudzisID/simoto-sklad/releases/latest',{headers:{'User-Agent':'SiMOTO','Accept':'application/json'}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{const j=JSON.parse(d);console.log('Latest version:',j.tag_name);const v='!curver!';const lv=j.tag_name.replace(/^v/,'');if(v!==lv){console.log('New version available!');console.log('Run github-push.bat to update');}else{console.log('You have latest version');}}catch(e){console.log('Parse error:',e.message);}});}).on('error',e=>console.log('Network error:'+e.message));}catch(e){console.log('Module error:'+e.message);}"

:: Wait a moment for network check to complete
timeout /t 3 /nobreak >nul

:: Start server in new window
echo.
echo [i] Starting server on http://localhost:3000
start "SiMOTO Server" cmd /c "cd /d %~dp0 && node server.js"

:: Give server time to start
echo [i] Waiting for server to start...
timeout /t 2 /nobreak >nul

:: Open browser
start http://localhost:3000

echo.
echo [OK] Browser opened - SiMOTO is running
echo [i] Press Ctrl+C in server window to stop, or close this window
echo.
pause