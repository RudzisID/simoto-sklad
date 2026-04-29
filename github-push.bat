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

:: Sync with remote before push
echo [i] Syncing with remote...
git pull --rebase origin main
if errorlevel 1 (
    echo [X] Pull --rebase failed! Resolve conflicts manually.
    echo     Run: git status
    echo     Then: git push origin main
    pause
    exit /b 1
)

:: Push
echo [i] Pushing to GitHub...
git push origin main
if errorlevel 1 (
    echo [X] Push failed!
    echo     Possible reason: remote has changes you don't have locally.
    echo     Try: git pull --rebase origin main
    pause
    exit /b 1
)
echo [OK] Pushed

:: Tag
echo [i] Creating tag...
git tag -a v!newver! -m "!newver!"
git push origin v!newver!
echo [OK] Tag: v!newver!

:: Create Release
echo [i] Creating release...
node scripts/create-release.js !newver!

echo.
echo ===============================================
echo    DONE! Version: v!newver!
echo ===============================================
echo.
echo Opening GitHub...
start https://github.com/RudzisID/simoto-sklad/releases

pause