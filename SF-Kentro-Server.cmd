@echo off
title SF Kentro (diakomistis)
cd /d "%~dp0"
if not exist "%~dp0runtime\node.exe" (
  echo Den vrethike to runtime\node.exe. Vgale OLO ton fakelo apo to zip prin to anoixeis.
  pause
  exit /b 1
)
rem Leitourgia diakomisti: oi alloi ypologistes anoigoun http://ONOMA-I-IP-AYTOU-TOU-PC:17321
set SFK_MODE=server
"%~dp0runtime\node.exe" "%~dp0app\server.js"
echo.
echo SF Kentro stopped. Press any key to close.
pause >nul
