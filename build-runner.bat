@echo off
setlocal

cd /d "%~dp0"

echo [build-runner] Building Orchestrator Runner...
cargo build --release --manifest-path "orchestrator-runner\Cargo.toml"
if errorlevel 1 exit /b %errorlevel%

set "RUNNER_BUILD=%~dp0orchestrator-runner\target\release\runner.exe"
set "RELEASE_DIR=%~dp0release"
set "GROOVY_JAR=%~dp0orchestrator-worker\groovyExec.jar"

if not exist "%RELEASE_DIR%" mkdir "%RELEASE_DIR%"
if errorlevel 1 exit /b %errorlevel%

move /y "%RUNNER_BUILD%" "%RELEASE_DIR%\runner.exe" >nul
if errorlevel 1 exit /b %errorlevel%

if exist "%GROOVY_JAR%" (
    copy /y "%GROOVY_JAR%" "%RELEASE_DIR%\groovyExec.jar" >nul
    if errorlevel 1 exit /b %errorlevel%
) else (
    echo [build-runner] Warning: groovyExec.jar was not found; Groovy fallback will require GROOVY_JAR.
)

echo [build-runner] Built "%RELEASE_DIR%\runner.exe"
exit /b 0
