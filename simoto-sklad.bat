@echo off
set "_batfile=%~f0"
setlocal enabledelayedexpansion
title SiMOTO-Sklad

:: Переход в директорию скрипта
cd /d "%~dp0"

:: ANSI цвета (через ESC-символ из PowerShell)
for /f %%a in ('powershell -NoProfile -Command "[char]27"') do set "ESC=%%a"
set "GREEN=%ESC%[92m"
set "RED=%ESC%[91m"
set "RESET=%ESC%[0m"

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
    echo GH_TOKEN= > .env
    echo [OK] Created .env
)

:: Create logs dir
if not exist "logs" mkdir logs

:: Get current version (reliable method)
node -p "require('./package.json').version" > "%TEMP%\ver.txt" 2>nul
set /p curver=<"%TEMP%\ver.txt"
del "%TEMP%\ver.txt" >nul 2>&1
echo [i] Current version: %curver%

:: Check for updates
echo.
echo [i] Checking for updates...
node scripts/check-update.js %curver% > "%TEMP%\ver_check.txt" 2>&1
if not exist "%TEMP%\ver_check.txt" goto start_server

findstr /C:"New version available" "%TEMP%\ver_check.txt" >nul 2>&1
if errorlevel 1 goto skip_update

:: Extract tag name (e.g. TAG_NAME=v1.4.0)
for /f "tokens=2 delims==" %%a in ('findstr /C:"TAG_NAME" "%TEMP%\ver_check.txt"') do set "NEW_TAG=%%a"

:update_prompt
echo.
echo %GREEN%[i] Рекомендуется установить обновление%RESET%
set "update_choice="
set /p "update_choice=%GREEN%y%RESET%/%GREEN%да%RESET% / %RED%n%RESET%/%RED%нет%RESET%: "

:: Normalize input: y/yes/да → y, n/no/нет/н → n
if /i "!update_choice!"=="y"   set "update_choice=y"
if /i "!update_choice!"=="yes" set "update_choice=y"
if /i "!update_choice!"=="да"  set "update_choice=y"
if /i "!update_choice!"=="n"   set "update_choice=n"
if /i "!update_choice!"=="no"  set "update_choice=n"
if /i "!update_choice!"=="нет" set "update_choice=n"
if /i "!update_choice!"=="н"   set "update_choice=n"

if not defined update_choice goto update_prompt
if "!update_choice!"=="y" goto do_update
if "!update_choice!"=="n" goto skip_update
goto update_prompt

:do_update
del "%TEMP%\ver_check.txt" >nul 2>&1
echo.
echo [i] Updating to version !NEW_TAG!...
node scripts/update.js !NEW_TAG!
if errorlevel 1 (
    echo [X] Update failed!
    pause
    exit /b 1
)
echo [OK] Updated! Restarting...
cmd /c start "" "%_batfile%"
exit /b 0

:skip_update
echo [i] Update skipped. Starting current version...
del "%TEMP%\ver_check.txt" >nul 2>&1

:start_server
:: Start server
echo.
echo [i] Starting server...
start http://localhost:3000
node server.js

echo.
echo [OK] Server stopped
pause
endlocal
