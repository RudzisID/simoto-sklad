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
git status --porcelain > temp_changes.txt
set count=0
for /f %%a in ('type temp_changes.txt ^| find /c /v ""') do set count=%%a

if !count! equ 0 (
    echo [!] No changes found
    echo.
    echo Make some edits to files first
    echo Then run github-push.bat again
    echo.
    del temp_changes.txt 2>nul
    pause
    exit /b 0
)

echo [OK] Files changed: !count!
echo.

:: Get current version using Node.js (more reliable)
for /f "delims=" %%a in ('node -e "try{console.log(require('./package.json').version)}catch(e){console.log('0.0.0')}"') do set ver=%%a
echo [i] Current version: !ver!

:: Bump version (patch)
for /f "tokens=1,2,3 delims=." %%a in ("!ver!") do (
    set major=%%a
    set minor=%%b
    set patch=%%c
)
set /a patch=!patch!+1
set newver=!major!.!minor!.!patch!

echo [i] New version: !newver!
echo.

:: Update package.json using PowerShell (more reliable cross-version)
powershell -NoProfile -Command "(Get-Content 'package.json' -Raw) -replace '\"version\": \"!ver!\"', '\"version\": \"!newver!\"' | Set-Content 'package.json'"

:: Verify update worked
for /f "delims=" %%a in ('node -e "console.log(require('./package.json').version)"') do set checkver=%%a
if not "!checkver!"=="!newver!" (
    echo [!] Version update failed!
    del temp_changes.txt 2>nul
    pause
    exit /b 1
)
echo [OK] Version updated to !newver!

:: Add files (except .env and temp files)
echo [i] Committing...
git add -A -- ':!.env' -- ':!temp_changes.txt'
git commit -m "release: v!newver!" >nul 2>&1
if errorlevel 1 (
    echo [!] Already up to date or nothing to commit
    del temp_changes.txt 2>nul
    pause
    exit /b 0
)

echo [OK] Commit created: v!newver!
echo.
echo [i] Pushing to GitHub...
git push origin main
if errorlevel 1 (
    echo [X] Push failed! Check your internet connection and credentials.
    echo [i] Make sure GH_TOKEN is set in .env
    del temp_changes.txt 2>nul
    pause
    exit /b 1
)

echo [OK] Pushed to GitHub
echo.
echo [i] Creating tag...
git tag -a v!newver! -m "Version !newver!"
git push origin v!newver!
if errorlevel 1 (
    echo [!] Tag push failed (tag may already exist)
) else (
    echo [OK] Tag created and pushed
)

echo.
echo ===============================================
echo    DONE! Version: v!newver!
echo ===============================================
echo.
echo Opening GitHub Releases...
start https://github.com/RudzisID/simoto-sklad/releases/new\?activeTab\=tags

del temp_changes.txt 2>nul
pause