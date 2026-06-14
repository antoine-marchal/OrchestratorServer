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

REM --- RPM spec: bump Version: tag (Release/changelog left untouched) ---
node -e "const fs=require('fs');const v='%VER%';const f='orchestrator-webpanel/packaging/rpm/orchestrator-webpanel.spec';let s=fs.readFileSync(f,'utf8');const m=s.match(/^(Version:\s*)(\S+)/m);if(!m){console.error('  '+f+' : Version: tag not found');process.exit(1);}fs.writeFileSync(f,s.replace(/^(Version:\s*)\S+/m,'$1'+v));console.log('  '+f+' : '+m[2]+' -> '+v);"

if errorlevel 1 (
  echo.
  echo  ERROR: failed to patch RPM spec version.
  pause
  exit /b 1
)

REM --- Presentation deck: bump the displayed version badges (vX.Y.Z) ---
REM Patches both the editable source and the generated standalone so a version
REM bump doesn't require a full rebuild. Content edits still need build-standalone.
node -e "const fs=require('fs');const v='%VER%';const files=['documentation/presentation/Orchestrator Presentation.html','documentation/presentation/Orchestrator Presentation - Standalone.html'];for(const f of files){if(!fs.existsSync(f)){console.log('  '+f+' : (absent, skipped)');continue;}let s=fs.readFileSync(f,'utf8');const before=s;s=s.replace(/v\d+\.\d+\.\d+/g,'v'+v);if(s!==before){fs.writeFileSync(f,s);console.log('  '+f+' : version badges -> v'+v);}else{console.log('  '+f+' : no version badge found');}}"

if errorlevel 1 (
  echo.
  echo  ERROR: failed to patch presentation deck version.
  pause
  exit /b 1
)

echo.
echo  Done.
echo.
pause
