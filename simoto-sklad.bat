@echo off
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
    exit
)
echo [OK] Node.js found

:: Check dependencies
if not exist "node_modules" (
    echo [!] Installing dependencies...
    call npm install
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

:: Get current version via Node.js
for /f %%a in ('node -e "console.log(require('./package.json').version)"') do set curver=%%a
echo [i] Current version: %curver%

:: Check for updates via Node.js
echo.
echo [i] Checking for updates...
node -e "
const https=require('https');
https.get('https://api.github.com/repos/RudzisID/simoto-sklad/releases/latest',{
headers:{'User-Agent':'SiMOTO'}
}).on('response',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{
try{
const j=JSON.parse(d);
console.log('Latest version:',j.tag_name);
const v='%curver%';
const lv=j.tag_name.replace('v','');
if(v!==lv){
console.log('New version available!');
console.log('Run github-push.bat to update');
}else{
console.log('You have latest version');
}
}catch(e){console.log('Error:',e.message);}
});}).on('error',e=>console.log('Network error'));
"

:: Start server
echo.
echo [i] Starting server...
start http://localhost:3000
node server.js

echo.
echo [OK] Server stopped
pause