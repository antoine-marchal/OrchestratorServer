@echo off
echo Starting all Orchestrator services...
echo.

start "Orchestrator Server" cmd /k "cd /d \"%~dp0orchestrator-webpanel\server\" && echo [Server] Starting... && npm run dev"

echo Waiting 4s for server to start...
timeout /t 4 /nobreak >nul

start "Orchestrator Client" cmd /k "cd /d \"%~dp0orchestrator-webpanel\client\" && echo [Client] Starting Vite... && npm run dev"
start "Orchestrator Worker" cmd /k "cd /d \"%~dp0orchestrator-worker\" && echo [Worker] Starting... && npm run dev"

echo.
echo  Server  ^>  http://localhost:3939
echo  Client  ^>  http://localhost:5173
echo  Worker  ^>  dev-worker (polls every 2s)
echo.
echo All services launched in separate windows.
pause
