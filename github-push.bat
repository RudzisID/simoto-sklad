@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

title SiMOTO GitHub Auto-Push

:: ============================================
:: GitHub Auto-Push Script
:: Автоматический пуш на GitHub с версионированием
:: ============================================

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║         SiMOTO GitHub Auto-Push v1.0.0                     ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

:: --- КОНФИГУРАЦИЯ ---
set "REPO_OWNER=RudzisID"
set "REPO_NAME=simoto-sklad"

:: Переключатели
set "BUMP_TYPE=patch"
set "AUTO_MODE=0"
set "DRY_RUN=0"

:: Парсинг аргументов
:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="major" set "BUMP_TYPE=major" & shift & goto :parse_args
if /i "%~1"=="minor" set "BUMP_TYPE=minor" & shift & goto :parse_args
if /i "%~1"=="patch" set "BUMP_TYPE=patch" & shift & goto :parse_args
if /i "%~1"=="auto" set "BUMP_TYPE=auto" & shift & goto :parse_args
if /i "%~1"=="--auto" set "AUTO_MODE=1" & shift & goto :parse_args
if /i "%~1"=="--dry-run" set "DRY_RUN=1" & shift & goto :parse_args
if /i "%~1"=="-y" set "AUTO_MODE=1" & shift & goto :parse_args
if /i "%~1"=="-n" set "DRY_RUN=1" & shift & goto :parse_args
if /i "%~1"=="--help" goto :show_help
if /i "%~1"=="-h" goto :show_help
shift
goto :parse_args

:args_done

:: --- ФУНКЦИИ ---

:check_git
echo [i] Проверка git...
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Git не найден! Установите Git
    pause
    exit /b 1
)

:: Проверка что мы в git репозитории
git rev-parse --git-dir >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Это не git репозиторий!
    pause
    exit /b 1
)
echo [OK] Git готов
exit /b 0

:check_token
echo.
echo [i] Проверка токена...

:: Проверяем GH_TOKEN из .env
if exist ".env" (
    findstr /C:"GH_TOKEN" ".env" >nul 2>&1
    if %errorlevel% equ 0 (
        echo [OK] GH_TOKEN найден в .env
        set "HAS_TOKEN=1"
    ) else (
        set "HAS_TOKEN=0"
    )
) else (
    set "HAS_TOKEN=0"
)

:: Проверяем из переменной окружения
if defined GH_TOKEN set "HAS_TOKEN=1"
if defined GITHUB_TOKEN set "HAS_TOKEN=1"

if "%HAS_TOKEN%"=="0" (
    echo [!] GitHub токен не найден
    echo.
    echo Для работы нужен Personal Access Token:
    echo   1. Перейдите на https://github.com/settings/tokens
    echo   2. Создайте токен с правами: repo
    echo   3. Добавьте в .env файл:
    echo      GH_TOKEN=ваш_токен
    echo.
    set /p CREATE_ENV="Создать .env файл? (Y/N): "
    if /i "!CREATE_ENV!"=="Y" (
        (
            echo # GitHub Personal Access Token
            echo GH_TOKEN=
            echo.
            echo # MoySklad API Token
            echo MOYSKLAD_TOKEN=your_token_here
        ) > .env
        echo [OK] Создан .env.template
        echo [!] Отредактируйте .env и добавьте ваш GH_TOKEN
        notepad .env
    )
    exit /b 1
)
exit /b 0

:get_changes
echo.
echo [i] Анализ изменений...
git status --porcelain > temp_changes.txt
set /a CHANGES_COUNT=0
for /f %%a in ('type temp_changes.txt ^| find /c /v ""') do set CHANGES_COUNT=%%a

if %CHANGES_COUNT% equ 0 (
    echo [!] Нет изменений для коммита
    del temp_changes.txt 2>nul
    exit /b 1
)

echo [OK] Изменено файлов: %CHANGES_COUNT%
exit /b 0

:get_current_version
if exist "package.json" (
    for /f "tokens=2 delims=:," %%a in ('findstr /C:"version" package.json') do set "CURRENT_VERSION=%%a"
    set "CURRENT_VERSION=%CURRENT_VERSION:"=%"
    set "CURRENT_VERSION=%CURRENT_VERSION: =%"
)
exit /b 0

:bump_version
:: Semver bump
call :get_current_version

for /f "tokens=1,2,3 delims=." %%a in ("%CURRENT_VERSION%") do (
    set "MAJOR=%%a"
    set "MINOR=%%b"
    set "PATCH=%%c"
)

if "%BUMP_TYPE%"=="major" (
    set /a MAJOR+=1
    set "MINOR=0"
    set "PATCH=0"
) else if "%BUMP_TYPE%"=="minor" (
    set /a MINOR+=1
    set "PATCH=0"
) else (
    set /a PATCH+=1
)

set "NEW_VERSION=%MAJOR%.%MINOR%.%PATCH%"

:: Обновляем package.json
powershell -Command "(Get-Content package.json) -replace '\"version\": \"%CURRENT_VERSION%\"', '\"version\": \"%NEW_VERSION%\"' | Set-Content package.json"

echo [OK] Версия: %CURRENT_VERSION% ^> %NEW_VERSION%
exit /b 0

:confirm_push
if "%AUTO_MODE%"=="1" exit /b 0

echo.
echo ═════════════════════════════════════════
echo   Версия будет обновлена до %NEW_VERSION%
echo   Тип: %BUMP_TYPE%
echo ═════════════════════════════════════════
echo.
set /p CONFIRM="Продолжить пуш на GitHub? (Y/N): "
if /i not "!CONFIRM!"=="Y" (
    echo [i] Отменено пользователем
    :: Откат версии в package.json
    powershell -Command "(Get-Content package.json) -replace '\"version\": \"%NEW_VERSION%\"', '\"version\": \"%CURRENT_VERSION%\"' | Set-Content package.json"
    exit /b 1
)
exit /b 0

:commit_and_push
echo.
echo [i] Создание коммита...
git add -A
git commit -m "release: v%NEW_VERSION%" 2>nul
if %errorlevel% neq 0 (
    echo [X] Ошибка коммита (возможно нет изменений)
    exit /b 1
)
echo [OK] Коммит создан

echo.
echo [i] Пуш на GitHub...
git push origin main
if %errorlevel% neq 0 (
    echo [X] Ошибка пуша
    git reset --soft HEAD~1
    exit /b 1
)
echo [OK] Пуш выполнен
exit /b 0

:create_tag
echo.
echo [i] Создание тега...

:: Удаляем старый тег локально и на remote
git tag -d v%NEW_VERSION% 2>nul
git push origin :refs/tags/v%NEW_VERSION% 2>nul

:: Создаём новый тег
git tag -a v%NEW_VERSION% -m "Version %NEW_VERSION%"
git push origin v%NEW_VERSION%
if %errorlevel% equ 0 (
    echo [OK] Тег v%NEW_VERSION% создан и запушен
) else (
    echo [!] Тег создан локально, но пуш не удался
)
exit /b 0

:create_release
echo.
echo [i] Создание GitHub Release...

:: Проверяем есть ли токен
call :check_token
if %errorlevel% neq 0 (
    echo [!] Нет токена - Release не будет создан
    exit /b 0
)

:: Используем Node.js скрипт для создания Release
node scripts\auto-push.js %BUMP_TYPE% --auto
exit /b 0

:show_help
echo.
echo SiMOTO GitHub Auto-Push
echo.
echo Использование:
echo   github-push.bat              - пуш с patch версией (1.0.0 -^> 1.0.1)
echo   github-push.bat minor        - пуш с minor версией (1.0.0 -^> 1.1.0)
echo   github-push.bat major        - пуш с major версией (1.0.0 -^> 2.0.0)
echo   github-push.bat --auto       - автоматический режим без подтверждения
echo   github-push.bat --dry-run    - тестовый прогон
echo   github-push.bat --help       - эта справка
echo.
echo Примеры:
echo   github-push.bat patch        - исправления багов
echo   github-push.bat minor        - новые функции
echo   github-push.bat major        - API изменения
echo.
pause
exit /b 0

:success
echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║  ✅ GitHub Auto-Push завершён!                            ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.
echo    Версия:   %NEW_VERSION%
echo    Репозиторий: https://github.com/%REPO_OWNER%/%REPO_NAME%
echo.
del temp_changes.txt 2>nul
exit /b 0

:: ============================================
:: ОСНОВНАЯ ПРОГРАММА
:: ============================================

:: Проверка Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Node.js не найден!
    exit /b 1
)

:: Проверка git
call :check_git
if %errorlevel% neq 0 exit /b 1

:: Анализ изменений
call :get_changes
if %errorlevel% neq 0 (
    echo [i] Завершение работы
    del temp_changes.txt 2>nul
    exit /b 0
)

:: Обновление версии
call :bump_version

:: Подтверждение
if "%DRY_RUN%"=="1" (
    echo.
    echo [i] DRY RUN - пуш не будет выполнен
    echo [i] Новая версия уже в package.json
    pause
    exit /b 0
)

call :confirm_push
if %errorlevel% neq 0 exit /b 0

:: Коммит и пуш
call :commit_and_push
if %errorlevel% neq 0 (
    echo [X] Ошибка пуша
    pause
    exit /b 1
)

:: Создание тега
call :create_tag

:: Создание Release через Node.js
call :create_release

:: Успех
call :success

pause >nul
endlocal