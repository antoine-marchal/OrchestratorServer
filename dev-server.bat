@echo off
title Orchestrator Server
cd /d "%~dp0orchestrator-webpanel\server"
echo.
echo  [Orchestrator Server]  MongoDB: 192.168.1.218:27017/orchestrator
echo  Listening on http://localhost:3939
echo.
npm run dev
pause
