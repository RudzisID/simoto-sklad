@echo off
chcp 65001 >nul 2>&1
title GitHub Push - SiMOTO-Sklad

:: ============================================
:: GitHub Push - Загрузка на GitHub
:: ============================================

setlocal enabledelayedexpansion

:: --- КОНФИГУРАЦИЯ ---
set "REPO_OWNER="
set "REPO_NAME=simoto-sklad"

:: Цвета
set "RED=[91m"
set "GREEN=[92m"
set "YELLOW=[93m"
set "BLUE=[94m"
set "NC=[0m"

:: ============================================
:: ФУНКЦИИ
:: ============================================

:check_git
echo.
echo %BLUE%📋 Проверка Git...%NC%
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%✖ Git не найден!%NC%
    echo Скачайте Git: https://git-scm.com
    echo Нажмите любую клавишу для выхода...
    pause >nul
    exit /b 1
)
echo %GREEN%✓ Git установлен%NC%
exit /b 0

:check_repo_url
echo.
echo %BLUE%🔗 Проверка URL репозитория...%NC%

:: Проверка настроен ли remote
git remote get origin >nul 2>&1
if %errorlevel% equ 0 (
    git remote get origin > temp_remote.txt
    set /p REMOTE_URL=<temp_remote.txt
    del temp_remote.txt

    echo %GREEN%✓ Репозиторий уже настроен:%NC%
    echo   %REMOTE_URL%

    set /p ANSWER="Использовать текущий репозиторий? (Y/N): "
    if /i "%ANSWER%"=="Y" (
        goto :prepare_push
    )
)
echo.
echo %YELLOW%Введите URL репозитория с GitHub:%NC%
echo Пример: https://github.com/ВАШ_НИК/simoto-sklad.git
echo.
set /p REPO_URL="URL: "

if "%REPO_URL%"=="" (
    echo %RED%✖ URL не введён!%NC%
    exit /b 1
)

:: Настройка remote
git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%

echo %GREEN%✓ Репозиторий настроен%NC%

:prepare_push
echo.
echo %BLUE%📝 Введите описание изменений:%NC%
set /p COMMIT_MSG="Сообщение: "

if "%COMMIT_MSG%"=="" (
    set COMMIT_MSG=Update
)

echo.
echo %BLUE%🔄 Добавление файлов...%NC%

:: Добавляем все файлы (кроме игнорируемых)
git add -A

:: Проверка есть ли изменения
git diff --cached --quiet 2>nul
if %errorlevel% equ 0 (
    echo %YELLOW%⚠ Нечего коммитить. Файлы уже обновлены.%NC%
    goto :push
)

echo.
echo %BLUE%💾 Создание коммита...%NC%
git commit -m "%COMMIT_MSG%"

if %errorlevel% neq 0 (
    echo %RED%✖ Ошибка создания коммита!%NC%
    exit /b 1
)

echo %GREEN%✓ Коммит создан%NC%

:push
echo.
echo %BLUE%⬆️ Отправка на GitHub...%NC%

:: Определение ветки
git branch > temp_branch.txt
set /p BRANCH=<temp_branch.txt
del temp_branch.txt

:: Основная ветка может быть main или master
echo.
echo %YELLOW%В какую ветку отправить? (по умолчанию main):%NC%
set /p TARGET_BRANCH="> "

if "%TARGET_BRANCH%"=="" (
    set TARGET_BRANCH=main
)

git push -u origin %TARGET_BRANCH%

if %errorlevel% equ 0 (
    echo.
    echo %GREEN%✓✓✓ Успешно отправлено на GitHub! ✓✓✓%NC%
    echo.
    echo Теперь создайте Release:
    echo 1. Зайдите на ваш репозиторий на GitHub
    echo 2. Нажмите 'Releases' ^> 'Draft a new release'
    echo 3. Введите версию (например v1.0.0)
    echo 4. Нажмите 'Publish release'
) else (
    echo %RED%✖ Ошибка отправки!%NC%
    echo Проверьте:
    echo - Есть ли интернет
    echo - Правильный ли URL репозитория
    echo - Авторизованы ли вы в Git
)

echo.
pause >nul
endlocal