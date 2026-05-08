@echo off
title Orchestrator Worker
cd /d "%~dp0orchestrator-worker"
echo.
echo  [Orchestrator Worker]  Connecting to http://localhost:3939
echo  Worker name: dev-worker
echo.
npm run dev
pause
