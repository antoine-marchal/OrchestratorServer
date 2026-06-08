@echo off
title Build Orchestrator Server
setlocal

if not exist "%~dp0release" mkdir "%~dp0release"

echo.
echo  [Build Server]  1/2  Building client + server TypeScript...
echo.
cd /d "%~dp0orchestrator-webpanel"
call npm run build:all
if errorlevel 1 goto fail

echo.
echo  [Build Server]  2/2  Packaging with pkg...
echo.
cd /d "%~dp0orchestrator-webpanel\server"

if "%1"=="win" (
  echo  Target: Windows x64
  call npm run pkg:win
) else if "%1"=="linux" (
  echo  Target: Linux x64
  call npm run pkg:linux
) else (
  echo  Target: Windows x64 + Linux x64
  call npm run pkg:all
)

if errorlevel 1 goto fail

copy /Y "%~dp0orchestrator-webpanel\server\.env.example" "%~dp0release\server.env.example" >nul

title Build Orchestrator Worker
setlocal

if not exist "%~dp0release" mkdir "%~dp0release"

echo.
echo  [Build Worker]  1/2  Building TypeScript...
echo.
cd /d "%~dp0orchestrator-worker"
call npm run build
if errorlevel 1 goto fail

echo.
echo  [Build Worker]  2/2  Packaging with pkg...
echo.

if "%1"=="win" (
  echo  Target: Windows x64
  call npm run pkg:win
) else if "%1"=="linux" (
  echo  Target: Linux x64
  call npm run pkg:linux
) else (
  echo  Target: Windows x64 + Linux x64
  call npm run pkg:all
)

if errorlevel 1 goto fail

copy /Y "%~dp0orchestrator-worker\.env.example" "%~dp0release\worker.env.example" >nul


title Deploy Orchestrator binaries
setlocal

set "SRC=%~dp0release"
set "DEST=M:\Workspace\tools"

if not exist "%SRC%" (
  echo  ERROR: release directory not found: %SRC%
  echo  Run build-server.bat / build-worker.bat first.
  goto fail
)
if not exist "%DEST%" (
  echo  Creating destination: %DEST%
  mkdir "%DEST%" 2>nul
  if errorlevel 1 (
    echo  ERROR: cannot create %DEST%
    goto fail
  )
)

echo.
echo  Deploy: %SRC%  ==^>  %DEST%
echo.

set "FOUND=0"

for %%F in ("%SRC%\*.env.example") do (
  set "FOUND=1"
  echo  copy  %%~nxF
  copy /Y "%%~fF" "%DEST%\%%~nxF" >nul
  if errorlevel 1 goto fail
)

for %%F in ("%SRC%\orchestrator-*") do (
  set "FOUND=1"
  echo  copy  %%~nxF
  copy /Y "%%~fF" "%DEST%\%%~nxF" >nul
  if errorlevel 1 goto fail
)

if "%FOUND%"=="0" (
  echo  ERROR: no matching files in %SRC%
  goto fail
)

echo.
echo  Done.
goto end

:fail
echo.
echo  DEPLOY FAILED
pause
exit /b 1

:end
pause
