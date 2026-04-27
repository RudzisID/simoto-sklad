@echo off
setlocal enabledelayedexpansion
title SiMOTO GitHub Push

echo.
echo ===============================================
echo    SiMOTO GitHub Auto-Push
echo ===============================================
echo.

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [X] Node.js not found!
    pause
    exit /b 1
)

:: Check Git
git --version >nul 2>&1
if errorlevel 1 (
    echo [X] Git not found!
    pause
    exit /b 1
)

echo [i] Checking for changes...
for /f %%a in ('git status --porcelain ^| find /c /v ""') do set count=%%a

if !count! equ 0 (
    echo [!] No changes found
    echo.
    echo Make some edits to files first
    echo Then run github-push.bat again
    echo.
    pause
    exit /b 0
)

echo [OK] Files changed: !count!
echo.

:: Get current version
for /f %%a in ('node -e "try{console.log(require('./package.json').version)}catch(e){console.log('0.0.0')}"') do set ver=%%a
echo [i] Current version: !ver!

:: Bump version
for /f "tokens=1,2,3 delims=." %%a in ("!ver!") do (
    set major=%%a
    set minor=%%b
    set patch=%%c
)
set /a patch=!patch!+1
set newver=!major!.!minor!.!patch!

echo [i] New version: !newver!
echo.

:: Update package.json
powershell -NoProfile -Command "(Get-Content 'package.json' -Raw) -replace '\"version\": \"!ver!\"', '\"version\": \"!newver!\"' | Set-Content 'package.json'"

:: Verify
for /f %%a in ('node -e "console.log(require('./package.json').version)"') do set checkver=%%a
if not "!checkver!"=="!newver!" (
    echo [!] Version update failed!
    pause
    exit /b 1
)
echo [OK] Version updated to !newver!

:: Commit
echo [i] Committing...
git add -A
git commit -m "release: v!newver!" >nul 2>&1
if errorlevel 1 (
    echo [!] Already up to date
    pause
    exit /b 0
)
echo [OK] Commit: v!newver!

:: Push
echo [i] Pushing to GitHub...
git push origin main
if errorlevel 1 (
    echo [X] Push failed!
    pause
    exit /b 1
)
echo [OK] Pushed

:: Tag
echo [i] Creating tag...
git tag -a v!newver! -m "!newver!"
git push origin v!newver!
echo [OK] Tag: v!newver!

:: Create Release via Node.js
echo [i] Creating release...
node -e "
const fs=require('fs');
const https=require('https');
const tok=(fs.readFileSync('.env','utf8')||'').match(/GH_TOKEN=(.+)/);
if(!tok){console.log('No GH_TOKEN');return;}
const data=''+JSON.stringify({tag_name:'v!newver!',name:'SiMOTO v!newver!',draft:false});
https.request({hostname:'api.github.com',path:'/repos/RudzisID/simoto-sklad/releases',method:'POST',headers:{'Authorization':'token '+tok[1],'Content-Type':'application/json','User-Agent':'SiMOTO'}},r=>{let d='',data2='';r.on('data',c=>d+=c);r.on('end',()=>{console.log(r.statusCode<300?'OK':'Failed');if(r.statusCode===201){const rel=JSON.parse(d);if(rel&&rel.id){console.log('Updating latest...');const p=''+JSON.stringify({draft:false});https.request({hostname:'api.github.com',path:'/repos/RudzisID/simoto-sklad/releases/'+rel.id,method:'PATCH',headers:{'Authorization':'token '+tok[1],'Content-Type':'application/json','User-Agent':'SiMOTO'}},r2=>{let d2='';r2.on('data',c=>d2+=c);r2.on('end',()=>console.log(r2.statusCode?'Latest updated':'Error updating'))}).on('error',e=>{}).end(p);}});}}).on('error',e=>console.log('Error')).end(data);
"

echo.
echo ===============================================
echo    DONE! Version: v!newver!
echo ===============================================
echo.
echo Opening GitHub...
start https://github.com/RudzisID/simoto-sklad/releases

pause