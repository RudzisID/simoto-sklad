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

:: Select version bump type
echo.
echo Select version bump type:
echo [1] Patch (!ver! -^> X.X.X+1^) - Bug fixes
echo [2] Minor (!ver! -^> X.X+1.0^)  - New features
echo [3] Major (!ver! -^> X+1.0.0^)  - Breaking changes
choice /c 123 /n /m "Your choice (1-3): "

set bump_type=patch
if errorlevel 3 set bump_type=major
if errorlevel 2 set bump_type=minor

:: Bump version
for /f "tokens=1,2,3 delims=." %%a in ("!ver!") do (
    set major=%%a
    set minor=%%b
    set patch=%%c
)

if "!bump_type!"=="major" (
    set /a major=!major!+1
    set minor=0
    set patch=0
) else if "!bump_type!"=="minor" (
    set /a minor=!minor!+1
    set patch=0
) else (
    set /a patch=!patch!+1
)
set newver=!major!.!minor!.!patch!

echo [i] New version: !newver!
echo.

:: Update package.json
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json')); p.version='!newver!'; fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n');"

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