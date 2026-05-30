@echo off
title Orchestrator Client (Vite)
cd /d "%~dp0orchestrator-webpanel\client"
echo.
echo  [Orchestrator Client]  Vite dev server
echo  UI available at http://localhost:5173
echo.
npm run dev
pause
