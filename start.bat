@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title SiMOTO Payment Module
cd /d "%~dp0"

echo ========================================
echo   SiMOTO Payment Module
echo ========================================

:: 1. Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [INFO] Node.js not found
    set /p INSTALL="Install Node.js? (Y/N): "
    if /i "!INSTALL!"=="Y" (
        echo [INSTALL] Trying to install Node.js via winget...
        winget install OpenJS.NodeJS --silent --accept-package-agreements --accept-source-agreements
        if errorlevel 1 (
            echo [ERROR] Cannot install Node.js automatically
            echo Solution: Run start.bat as Administrator
            echo Or download from https://nodejs.org
            pause
            exit /b 1
        )
    ) else (
        echo [INFO] Node.js is required
        echo Download from https://nodejs.org
        pause
        exit /b 1
    )
) else (
    echo [OK] Node.js found
)

:: 2. Check node_modules
if not exist "node_modules" (
    echo [INFO] Dependencies not installed
    set /p INSTALL="Run npm install? (Y/N): "
    if /i "!INSTALL!"=="Y" (
        echo [INSTALL] npm install...
        call npm install
        if errorlevel 1 (
            echo [ERROR] npm install failed
            echo Solution: Check package.json and internet connection
            pause
            exit /b 1
        )
    ) else (
        echo [INFO] Dependencies not installed. Cannot start.
        pause
        exit /b 1
    )
) else (
    echo [OK] Dependencies installed
)

:: 3. Check .env
if not exist ".env" (
    echo [INFO] .env file not found
    set /p CREATE="Create .env file? (Y/N): "
    if /i "!CREATE!"=="Y" (
        echo [INFO] Creating .env...
        (
            echo # MoySklad API
            echo MOYSKLAD_TOKEN=your_token_here
            echo MOYSKLAD_BASE=https://api.moysklad.ru/api/remap/1.2
            echo.
            echo # Server port ^(optional^)
            echo PORT=3000
        ) > .env
        echo [DONE] .env file created
        echo Edit it and add your API keys
        echo.
    )
) else (
    echo [OK] .env file found
)

:: 4. Start server
echo ========================================
echo   Starting server...
echo ========================================
node server.js
if errorlevel 1 (
    echo [ERROR] Server exited with error
    echo Check logs above
    pause
    exit /b 1
)