@echo off
chcp 65001 >nul 2>&1
title GitHub Push - SiMOTO-Sklad

:: ============================================
:: GitHub Push - Upload to GitHub
:: ============================================

setlocal enabledelayedexpansion

:: --- CONFIG ---
set "REPO_OWNER="
set "REPO_NAME=simoto-sklad"

:: ============================================
:: FUNCTIONS
:: ============================================

:check_git
echo.
echo [i] Checking Git...
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Git not found!
    echo Download Git: https://git-scm.com
    pause >nul
    exit /b 1
)
echo [OK] Git is installed
exit /b 0

:check_repo_url
echo.
echo [i] Checking repository URL...

git remote get origin >nul 2>&1
if %errorlevel% equ 0 (
    git remote get origin > temp_remote.txt
    set /p REMOTE_URL=<temp_remote.txt
    del temp_remote.txt

    echo [OK] Repository already configured:
    echo   %REMOTE_URL%

    set /p ANSWER="Use current repository? (Y/N): "
    if /i "%ANSWER%"=="Y" (
        goto :prepare_push
    )
)
echo.
echo Enter repository URL from GitHub:
echo Example: https://github.com/YOUR_NICK/simoto-sklad.git
echo.
set /p REPO_URL="URL: "

if "%REPO_URL%"=="" (
    echo [X] URL not entered!
    exit /b 1
)

git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%

echo [OK] Repository configured

:prepare_push
echo.
echo [i] Enter commit message:
set /p COMMIT_MSG="Message: "

if "%COMMIT_MSG%"=="" (
    set COMMIT_MSG=Update
)

echo.
echo [i] Adding files...
git add -A

git diff --cached --quiet 2>nul
if %errorlevel% equ 0 (
    echo [!] Nothing to commit. Files are already up to date.
    goto :push
)

echo.
echo [i] Creating commit...
git commit -m "%COMMIT_MSG%"

if %errorlevel% neq 0 (
    echo [X] Commit error!
    exit /b 1
)

echo [OK] Commit created

:push
echo.
echo [i] Pushing to GitHub...

git branch > temp_branch.txt
set /p BRANCH=<temp_branch.txt
del temp_branch.txt

echo.
echo Which branch? (default: main):
set /p TARGET_BRANCH="> "

if "%TARGET_BRANCH%"=="" (
    set TARGET_BRANCH=main
)

git push -u origin %TARGET_BRANCH%

if %errorlevel% equ 0 (
    echo.
    echo [OK][OK][OK] Successfully pushed to GitHub! [OK][OK][OK]
    echo.
    echo Now create Release:
    echo 1. Go to your repository on GitHub
    echo 2. Click 'Releases' ^> 'Draft a new release'
    echo 3. Enter version (e.g. v1.0.0)
    echo 4. Click 'Publish release'
) else (
    echo [X] Push error!
    echo Check:
    echo - Internet connection
    echo - Correct repository URL
    echo - You are logged in to Git
)

echo.
pause >nul
endlocal