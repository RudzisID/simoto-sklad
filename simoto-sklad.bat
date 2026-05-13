@echo off
set "_batfile=%~f0"
setlocal enabledelayedexpansion
title SiMOTO-Sklad

:: Переход в директорию скрипта
cd /d "%~dp0"

:: Вспомогательная функция для цветного вывода через PowerShell
set "PSCMD=powershell -NoProfile -Command"


echo.
echo ===============================================
echo    SiMOTO-Sklad Launcher
echo ===============================================
echo.

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    %PSCMD% "Write-Host '[X] Node.js not found!' -ForegroundColor Red"
    pause
    exit /b 1
)
%PSCMD% "Write-Host '[OK] Node.js found' -ForegroundColor Green"

:: Check dependencies
if not exist "node_modules" (
    %PSCMD% "Write-Host '[!] Installing dependencies...' -ForegroundColor Yellow"
    call npm install
    if errorlevel 1 (
        %PSCMD% "Write-Host '[X] npm install failed!' -ForegroundColor Red"
        pause
        exit /b 1
    )
    %PSCMD% "Write-Host '[OK] Dependencies installed' -ForegroundColor Green"
) else (
    %PSCMD% "Write-Host '[OK] Dependencies ready' -ForegroundColor Green"
)

:: Check .env
if not exist ".env" (
    echo GH_TOKEN= > .env
    %PSCMD% "Write-Host '[OK] Created .env' -ForegroundColor Green"
)

:: Create logs dir
if not exist "logs" mkdir logs

:: Get current version (reliable method)
node -p "require('./package.json').version" > "%TEMP%\ver.txt" 2>nul
set /p curver=<"%TEMP%\ver.txt"
del "%TEMP%\ver.txt" >nul 2>&1
%PSCMD% "Write-Host ('[i] Current version: ' + '%curver%') -ForegroundColor Cyan"

:: Check for updates
echo.
%PSCMD% "Write-Host '[i] Checking for updates...' -ForegroundColor Cyan"
node scripts/check-update.js %curver% > "%TEMP%\ver_check.txt" 2>&1
if not exist "%TEMP%\ver_check.txt" goto start_server

findstr /C:"New version available" "%TEMP%\ver_check.txt" >nul 2>&1
if errorlevel 1 goto skip_update

:: Extract tag name (e.g. TAG_NAME=v1.4.0)
for /f "tokens=2 delims==" %%a in ('findstr /C:"TAG_NAME" "%TEMP%\ver_check.txt"') do set "NEW_TAG=%%a"

:update_prompt
echo.
%PSCMD% "Write-Host '[i] Рекомендуется установить обновление' -ForegroundColor Green"
set "update_choice="
%PSCMD% -NoProfile -Command "Write-Host 'y' -ForegroundColor Green -NoNewline; Write-Host '/' -NoNewline; Write-Host 'да' -ForegroundColor Green -NoNewline; Write-Host ' / ' -NoNewline; Write-Host 'n' -ForegroundColor Red -NoNewline; Write-Host '/' -NoNewline; Write-Host 'нет' -ForegroundColor Red -NoNewline; Write-Host ': ' -NoNewline"
set /p "update_choice="

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
%PSCMD% "Write-Host ('[i] Updating to version ' + '!NEW_TAG!' + '...') -ForegroundColor Cyan"
node scripts/update.js !NEW_TAG!
if errorlevel 1 (
    %PSCMD% "Write-Host '[X] Update failed!' -ForegroundColor Red"
    pause
    exit /b 1
)
%PSCMD% "Write-Host '[OK] Updated! Restarting...' -ForegroundColor Green"
cmd /c start "" "%_batfile%"
exit /b 0

:skip_update
%PSCMD% "Write-Host '[i] Update skipped. Starting current version...' -ForegroundColor Cyan"
del "%TEMP%\ver_check.txt" >nul 2>&1

:start_server
:: Start server
echo.
%PSCMD% "Write-Host '[i] Starting server...' -ForegroundColor Cyan"
start http://localhost:3000
node server.js

echo.
%PSCMD% "Write-Host '[OK] Server stopped' -ForegroundColor Yellow"
pause
endlocal
