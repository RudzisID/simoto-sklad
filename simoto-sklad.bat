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
    echo Install from: https://nodejs.org
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
    echo [!] Creating .env file...
    (
        echo # GitHub Token (optional)
        echo GH_TOKEN=
        echo.
        echo # MoySklad Token - enter in browser
    ) > .env
    echo [OK] Created .env
) else (
    echo [OK] .env ready
)

:: Create logs dir
if not exist "logs" mkdir logs

:: Check for updates
echo.
echo [i] Checking for updates...
curl -s https://api.github.com/repos/RudzisID/simoto-sklad/releases/latest > temp_release.json 2>&1
findstr /C:"tag_name" temp_release.json >nul 2>&1
if errorlevel 1 (
    echo [!] Could not check updates
) else (
    for /f "tokens=2 delims=:" %%a in ('findstr /C:"tag_name" temp_release.json') do set newver=%%a
    set newver=%newver:~1,-1%
    for /f "tokens=2 delims=," %%a in ('findstr /C:"version" package.json') do set curver=%%a
    set curver=%curver:"=%
    set curver=%curver: =%

    echo Current: %curver%
    echo Latest:  %newver%

    if not "%curver%"=="%newver%" (
        echo [!] New version available!
    ) else (
        echo [OK] You have latest version
    )
)
del temp_release.json 2>nul

:: Start server
echo.
echo [i] Starting server...
start http://localhost:3000
node server.js

echo.
echo [OK] Server stopped
pause