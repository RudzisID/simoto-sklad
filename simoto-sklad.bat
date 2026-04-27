@echo off
chcp 65001 >nul 2>&1
title SiMOTO-Sklad

:: ============================================
:: SiMOTO-Sklad Launcher
:: Auto check, update and launch
:: ============================================

setlocal enabledelayedexpansion

:: --- CONFIG ---
set "REPO_OWNER=RudzisID"
set "REPO_NAME=simoto-sklad"
set "GITHUB_API=https://api.github.com/repos/%REPO_OWNER%/%REPO_NAME%"
set "VERSION_URL=%GITHUB_API%/releases/latest"
set "DOWNLOAD_URL=%GITHUB_API%/archive/refs/tags"

:: --- FUNCTIONS ---

:check_node
echo.
echo [i] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Node.js not found! Install from https://nodejs.org
    pause >nul
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo [OK] Node.js: %NODE_VERSION%
exit /b 0

:check_dependencies
echo.
echo [i] Checking dependencies...
if not exist "node_modules" (
    echo [!] node_modules not found. Installing...
    call npm install
    if %errorlevel% neq 0 (
        echo [X] Dependency install error!
        exit /b 1
    )
    echo [OK] Dependencies installed
) else (
    echo [OK] Dependencies already installed
)
exit /b 0

:check_env
echo.
echo [i] Checking .env...
if not exist ".env" (
    echo [!] .env not found. Creating...
    (
        echo # API Token for MoySklad
        echo MOYSKLAD_TOKEN=your_token_here
    ) > .env
    echo [OK] Created .env
    echo [!] IMPORTANT: Edit .env and add your API token!
    timeout /t 5 /nobreak >nul
) else (
    echo [OK] .env found
)
exit /b 0

:get_current_version
if exist "package.json" (
    for /f "tokens=2 delims=:," %%a in ('findstr /C:"version" package.json') do set CURRENT_VERSION=%%a
    set "CURRENT_VERSION=%CURRENT_VERSION:"=%"
    set "CURRENT_VERSION=%CURRENT_VERSION: =%"
)
exit /b 0

:check_updates
echo.
echo [i] Checking for updates...

:: Try to get version from GitHub API
curl -s -L "%VERSION_URL%" 2>nul > temp_release.json 2>&1
if exist temp_release.json (
    :: Извлекаем tag_name и zipball_url
    findstr /C:"tag_name" temp_release.json >temp_version.txt 2>&1
    findstr /C:"zipball_url" temp_release.json >temp_download.txt 2>&1
    
    if %errorlevel% equ 0 (
        for /f "tokens=2 delims=^" %%a in (temp_version.txt) do set "LATEST_VERSION=%%a"
        set "LATEST_VERSION=%LATEST_VERSION:~1,-1%"
        set "LATEST_VERSION=%LATEST_VERSION: =%"
        
        for /f "tokens=2 delims=^" %%a in (temp_download.txt) do set "ZIPBALL_URL=%%a"
        set "ZIPBALL_URL=%ZIPBALL_URL:~1,-1%"
        
        echo Current version: %CURRENT_VERSION%
        echo Latest version:  %LATEST_VERSION%

        if "%CURRENT_VERSION%" neq "%LATEST_VERSION%" (
            echo.
            echo [!] New version available: %LATEST_VERSION%
            
            set /p UPDATE_NOW="Download and install update? (Y/N): "
            if /i "!UPDATE_NOW!"=="Y" (
                echo Downloading update...
                
                :: Скачиваем архив релиза
                curl -s -L "%ZIPBALL_URL%" -o update.zip
                if exist "update.zip" (
                    :: Распаковываем
                    powershell -Command "Expand-Archive -Force update.zip ."
                    
                    :: Находим распакованную директорию
                    for /d %%d in (simoto-sklad-*) do (
                        echo Updating files from %%d...
                        xcopy /e /y /q "%%d\lib\*" "lib\" 2>nul
                        xcopy /e /y /q "%%d\*.js" ". " 2>nul
                        xcopy /e /y /q "%%d\*.json" ". " 2>nul
                        xcopy /e /y /q "%%d\*.md" ". " 2>nul
                        xcopy /e /y /q "%%d\public\*" "public\" 2>nul
                        xcopy /e /y /q "%%d\scripts\*" "scripts\" 2>nul
                        rmdir /s /q "%%d" 2>nul
                    )
                    
                    del update.zip 2>nul
                    echo [OK] Update installed!
                    set UPDATED=1
                )
            )
        ) else (
            echo [OK] You have the latest version
        )
    ) else (
        echo [!] Could not parse release info
        echo Continuing...
    )
) else (
    echo [!] Could not check updates (no internet?)
    echo Continuing...
)
del temp_version.txt 2>nul
del temp_download.txt 2>nul
del temp_release.json 2>nul
exit /b 0

:create_logs
if not exist "logs" mkdir logs
exit /b 0

:start_server
echo.
echo [i] Starting server...
start http://localhost:3000
node server.js
exit /b 0

:: ============================================
:: MAIN PROGRAM
:: ============================================

:: Get version first
call :get_current_version
if not defined CURRENT_VERSION set "CURRENT_VERSION=1.0.0"

echo.
echo ============================================
echo   SiMOTO-Sklad v%CURRENT_VERSION%
echo   Payment Automation Module
echo ============================================
echo.

:: Check Node.js
call :check_node
if %errorlevel% neq 0 exit /b 1

:: Check dependencies
call :check_dependencies
if %errorlevel% neq 0 exit /b 1

:: Check .env
call :check_env

:: Get version
call :get_current_version

:: Check updates (if internet available)
call :check_updates

:: Create logs directory
call :create_logs

:: Start server
call :start_server

echo.
echo [OK] Server stopped
pause >nul
endlocal