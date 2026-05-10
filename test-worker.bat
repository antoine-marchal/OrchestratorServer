@echo off
setlocal
cd /d "C:\workspace\OrchestratorServer\orchestrator-worker"
echo STEP1_BEFORE_BUILD
npm run build
echo STEP2_AFTER_BUILD_ERRORLEVEL_%ERRORLEVEL%
if errorlevel 1 (echo GOTO_FAIL && goto fail)
echo STEP3_BEFORE_PKG
if "win"=="win" (
  echo STEP4_IN_WIN_BLOCK
  npm run pkg:win
  echo STEP5_AFTER_PKG
)
echo STEP6_DONE
goto end
:fail
echo BUILD_FAILED
:end
