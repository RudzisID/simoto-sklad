@echo off
chcp 65001 >nul 2>&1
title SiMOTO-Sklad

:: ============================================
:: SiMOTO-Sklad Launcher
:: Автоматическая проверка, обновление и запуск
:: ============================================

setlocal enabledelayedexpansion

:: --- КОНФИГУРАЦИЯ ---
set "REPO_OWNER=ВАШ_НИК"
set "REPO_NAME=simoto-sklad"
set "VERSION_URL=https://api.github.com/repos/%REPO_OWNER%/%REPO_NAME%/releases/latest"
set "DOWNLOAD_URL=https://github.com/%REPO_OWNER%/%REPO_NAME%/archive/refs/heads/main.zip"

:: Цвета
set "RED=[91m"
set "GREEN=[92m"
set "YELLOW=[93m"
set "BLUE=[94m"
set "NC=[0m"

:: ============================================
:: ФУНКЦИИ
:: ============================================

:check_node
echo.
echo %BLUE%📋 Проверка Node.js...%NC%
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%✖ Node.js не найден! Установите с https://nodejs.org%NC%
    echo Нажмите любую клавишу для выхода...
    pause >nul
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo %GREEN%✓ Node.js: %NODE_VERSION%%NC%
exit /b 0

:check_dependencies
echo.
echo %BLUE%📦 Проверка зависимостей...%NC%
if not exist "node_modules" (
    echo %YELLOW%⚠ node_modules не найдены. Установка...%NC%
    call npm install
    if %errorlevel% neq 0 (
        echo %RED%✖ Ошибка установки зависимостей!%NC%
        exit /b 1
    )
    echo %GREEN%✓ Зависимости установлены%NC%
) else (
    echo %GREEN%✓ Зависимости уже установлены%NC%
)
exit /b 0

:check_env
echo.
echo %BLUE%🔐 Проверка .env...%NC%
if not exist ".env" (
    echo %YELLOW%⚠ Файл .env не найден. Создаю...%NC%
    (
        echo # API Token МойСклад
        echo MOYSKLAD_TOKEN=your_token_here
    ) > .env
    echo %GREEN%✓ Создан файл .env%NC%
    echo %YELLOW%⚠ ВАЖНО: Отредактируйте .env и добавьте ваш токен API!%NC%
    timeout /t 5 /nobreak >nul
) else (
    echo %GREEN%✓ Файл .env найден%NC%
)
exit /b 0

:get_current_version
if exist "package.json" (
    for /f "tokens=2 delims=:, " %%a in ('findstr /C:"version" package.json') do set CURRENT_VERSION=%%a
    set "CURRENT_VERSION=%CURRENT_VERSION:"=%"
    set "CURRENT_VERSION=%CURRENT_VERSION: =%"
)
exit /b 0

:check_updates
echo.
echo %BLUE%🔄 Проверка обновлений...%NC%

:: Попытка получить версию с GitHub
curl -s -L "%VERSION_URL%" 2>nul | findstr /C:"tag_name" >temp_version.txt 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=2 delims=^" %%a in (temp_version.txt) do set "LATEST_VERSION=%%a"
    set "LATEST_VERSION=%LATEST_VERSION:~1,-1%"
    set "LATEST_VERSION=%LATEST_VERSION: =%"

    echo Текущая версия: %CURRENT_VERSION%
    echo Последняя версия:  %LATEST_VERSION%

    if "%CURRENT_VERSION%" neq "%LATEST_VERSION%" (
        echo.
        echo %YELLOW%⚠ Доступна новая версия: %LATEST_VERSION%%NC%
        echo Загружаю обновление...

        curl -s -L "%DOWNLOAD_URL%" -o update.zip
        if exist "update.zip" (
            powershell -Command "Expand-Archive -Force update.zip ."
            del update.zip 2>nul

            :: Копирование файлов (кроме node_modules и лог��в)
            xcopy /e /y /q "simoto-sklad-main\lib\*" "lib\" 2>nul
            xcopy /e /y /q "simoto-sklad-main\*.js" ". " 2>nul
            xcopy /e /y /q "simoto-sklad-main\*.json" ". " 2>nul
            xcopy /e /y /q "simoto-sklad-main\*.md" ". " 2>nul
            xcopy /e /y /q "simoto-sklad-main\public\*" "public\" 2>nul

            rmdir /s /q "simoto-sklad-main" 2>nul

            echo %GREEN%✓ Обновление установлено!%NC%
            set UPDATED=1
        )
    ) else (
        echo %GREEN%✓ У вас последняя версия%NC%
    )
) else (
    echo %YELLOW%⚠ Не удалось проверить обновления (нет интернета?)%NC%
    echo Продолжаю запуск...
)
del temp_version.txt 2>nul
exit /b 0

:create_logs
if not exist "logs" mkdir logs
exit /b 0

:start_server
echo.
echo %BLUE%🚀 Запуск сервера...%NC%
start http://localhost:3000
node server.js
exit /b 0

:: ============================================
:: ОСНОВНАЯ ПРОГРАММА
:: ============================================

echo.
echo ============================================
echo   SiMOTO-Sklad v1.0.0
echo   Модуль автоматизации платежей
echo ============================================
echo.

:: Проверка Node.js
call :check_node
if %errorlevel% neq 0 exit /b 1

:: Проверка зависимостей
call :check_dependencies
if %errorlevel% neq 0 exit /b 1

:: Проверка .env
call :check_env

:: Получение версии
call :get_current_version

:: Проверка обновлений (только если есть интернет)
call :check_updates

:: Создание директории логов
call :create_logs

:: Запуск сервера
call :start_server

echo.
echo %GREEN%✓ Сервер остановлен%NC%
pause >nul
endlocal