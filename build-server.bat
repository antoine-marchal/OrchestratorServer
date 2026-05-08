@echo off
title Build Orchestrator Server
setlocal

if not exist "%~dp0release" mkdir "%~dp0release"

echo.
echo  [Build Server]  1/2  Building client + server TypeScript...
echo.
cd /d "%~dp0orchestrator-webpanel"
npm run build:all
if errorlevel 1 goto fail

echo.
echo  [Build Server]  2/2  Packaging with pkg...
echo.
cd /d "%~dp0orchestrator-webpanel\server"

if "%1"=="win" (
  echo  Target: Windows x64
  npm run pkg:win
) else if "%1"=="linux" (
  echo  Target: Linux x64
  npm run pkg:linux
) else (
  echo  Target: Windows x64 + Linux x64
  npm run pkg:all
)

if errorlevel 1 goto fail

echo.
echo  Done. Binaries in release\
echo.
echo  orchestrator-server-win.exe   ^<-- Windows
echo  orchestrator-server-linux     ^<-- Linux
echo.
echo  Place a .env file next to the binary before running:
echo    PORT=3939
echo    JWT_SECRET=...
echo    REFRESH_SECRET=...
echo    DB_PATH=./data
echo.
goto end

:fail
echo.
echo  BUILD FAILED
pause
exit /b 1

:end
pause
