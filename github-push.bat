@echo off
title SiMOTO GitHub Push

echo.
echo ===============================================
echo    SiMOTO GitHub Auto-Push
echo ===============================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Node.js not found!
    pause
    exit
)

:: Check Git
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Git not found!
    pause
    exit
)

echo [i] Checking for changes...
git status --porcelain > temp_changes.txt
set /a count=0
for /f %%a in ('type temp_changes.txt ^| find /c /v ""') do set count=%%a

if %count% equ 0 (
    echo [!] No changes found
    echo.
    echo Make some edits to files first
    echo Then run github-push.bat again
    echo.
    pause
    del temp_changes.txt 2>nul
    exit
)

echo [OK] Files changed: %count%
echo.

:: Get current version using Node.js (more reliable)
for /f %%a in ('node -e "console.log(require('./package.json').version)"') do set ver=%%a
echo [i] Current version: %ver%

:: Bump version (patch)
for /f "tokens=1,2,3 delims=." %%a in ("%ver%") do (
    set a=%%a
    set b=%%b
    set c=%%c
)
set /a c=%c%+1
set newver=%a%.%b%.%c%

echo [i] New version: %newver%
echo.

:: Update package.json
powershell -Command "(Get-Content package.json) -replace '\"version\": \"%ver%\"', '\"version\": \"%newver%\"' | Set-Content package.json"

:: Add files (except .env)
echo [i] Committing...
git add -A -- :!*.env :!*.env
git commit -m "release: v%newver%" >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Already up to date
    del temp_changes.txt 2>nul
    pause
    exit
)

echo [OK] Commit created
echo.
echo [i] Pushing to GitHub...
git push origin main
if %errorlevel% neq 0 (
    echo [X] Push failed!
    pause
    exit
)

echo [OK] Pushed to GitHub
echo.
echo [i] Creating tag...
git tag -a v%newver% -m "Version %newver%"
git push origin v%newver%
echo [OK] Tag created

echo.
echo ===============================================
echo    DONE! Version: v%newver%
echo ===============================================
echo.
echo Check: https://github.com/RudzisID/simoto-sklad/releases
echo.

del temp_changes.txt 2>nul
pause