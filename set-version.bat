@echo off
setlocal

cd /d "%~dp0"

set "VER=%~1"

if "%VER%"=="" (
  if exist ".version" (
    set /p VER=<".version"
  )
)

if "%VER%"=="" (
  echo.
  echo  Usage:  set-version.bat ^<version^>
  echo      or: Edit .version then run set-version.bat with no args
  echo.
  pause
  exit /b 1
)

echo.
echo  [set-version]  Applying version: %VER%
echo.

echo %VER%>.version

node -e "const fs=require('fs');const v='%VER%';const files=['orchestrator-worker/package.json','orchestrator-webpanel/server/package.json','orchestrator-webpanel/client/package.json'];for(const f of files){const raw=fs.readFileSync(f,'utf8');const j=JSON.parse(raw);const prev=j.version;j.version=v;fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n');console.log('  '+f+' : '+prev+' -> '+v);}"

if errorlevel 1 (
  echo.
  echo  ERROR: node.exe not found or script failed.
  pause
  exit /b 1
)

echo.
echo  Done.
echo.
pause
