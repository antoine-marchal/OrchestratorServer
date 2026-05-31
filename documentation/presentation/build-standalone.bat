@echo off
REM Genere "Orchestrator Presentation - Standalone.html" (fichier unique autonome).
REM Usage : build-standalone.bat [--no-fonts]
cd /d "%~dp0"
node build-standalone.mjs %*
if errorlevel 1 (
  echo.
  echo ECHEC de la generation.
  exit /b 1
)
echo.
echo OK - Orchestrator Presentation - Standalone.html genere.
