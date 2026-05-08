@echo off
title Build Orchestrator Worker
cd /d "%~dp0orchestrator-worker"
echo.
echo  [Build Worker]  Compiling TypeScript + packaging with pkg...
echo.

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

if errorlevel 1 (
  echo.
  echo  BUILD FAILED
  pause
  exit /b 1
)

echo.
echo  Done. Binaries in orchestrator-worker\release\
echo.
echo  orchestrator-worker-win.exe   ^<-- Windows
echo  orchestrator-worker-linux     ^<-- Linux
echo.
echo  Place a .env file next to the binary before running:
echo    ORCHESTRATOR_URL=http://your-server:3939
echo    WORKER_NAME=my-worker
echo    WORKER_REGISTRATION_SECRET=...
echo    ORCHESTRATOR_WORK_DIR=/path/to/workdir
echo.
pause
