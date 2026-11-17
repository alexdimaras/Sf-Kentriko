@echo off
rem SF Kentro - o ypologistis tou magaziou doulevei gia to programma sto cloud (erevna timon, sto paraskinio).
rem Den xreiazetai kodiko diaxeiristi ton Windows. Den grafei pote sta sites. Kanei mono ti douleia pou tou dinei to cloud.
title SF Kentro - Ypologistis
cd /d "%~dp0"
chcp 65001 >nul
set "NODE=%~dp0runtime\node.exe"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\SF-Kentro-Worker.vbs"
if not exist "%NODE%" (
  echo Den vrethike to runtime\node.exe. Vgale OLO ton fakelo apo to zip prin to anoixeis.
  pause
  exit /b 1
)
echo.
echo  SF Kentro - o ypologistis doulevei gia to programma
echo  ===================================================
if exist "%APPDATA%\SF-Kentro-Worker\worker.json" goto paired

:pair
echo.
echo  1. Sto programma: Rythmiseis - Ypologistes - "Neos kodikos".
echo  2. Grapse edo ti dieythynsi kai ton kodiko pou deixnei.
echo.
set "ADDR="
set "CODE="
set /p ADDR=  Dieythynsi (p.x. https://sf-kentro.onrender.com): 
set /p CODE=  Kodikos (p.x. ABCD-2345): 
"%NODE%" "%~dp0app\worker.js" pair "%ADDR%" "%CODE%"
if errorlevel 1 (
  echo.
  echo  Den egine. Elegxe ti dieythynsi kai ton kodiko ^(isxyei 15 lepta, mia fora^).
  pause
  exit /b 1
)
goto install

:paired
echo.
"%NODE%" "%~dp0app\worker.js" status
echo.
echo  1 = Na doulevei ^(ksekinaei me ta Windows, sto paraskinio^)
echo  2 = Nea syzeuxi ^(allo programma i neos kodikos^)
echo  3 = Na stamatisei kai na mi ksekinaei pia
echo  4 = Exodos
choice /c 1234 /n /m "  Epilogi: "
if errorlevel 4 exit /b 0
if errorlevel 3 goto remove
if errorlevel 2 goto pair
goto install

:install
call :stop
rem the hidden starter: runs the worker without a window, again after a crash (not after "removed" or "not paired")
> "%STARTUP%" echo Set sh = CreateObject("WScript.Shell")
>> "%STARTUP%" echo Do
>> "%STARTUP%" echo   rc = sh.Run("""%NODE%"" ""%~dp0app\worker.js""", 0, True)
>> "%STARTUP%" echo   If rc = 2 Or rc = 3 Then Exit Do
>> "%STARTUP%" echo   WScript.Sleep 60000
>> "%STARTUP%" echo Loop
start "" wscript.exe "%STARTUP%"
echo.
echo  Etoimo. O ypologistis doulevei tora sto paraskinio, me xamili proteraiotita,
echo  kai tha ksekinaei mono tou me ta Windows. Se mpataria den pairnei douleia.
echo  Fainetai sto programma: Rythmiseis - Ypologistes.
echo.
pause
exit /b 0

:remove
call :stop
if exist "%STARTUP%" del "%STARTUP%"
echo.
echo  Stamatise. Den tha ksekinaei pia me ta Windows.
echo  Gia na fygei kai apo to programma: Rythmiseis - Ypologistes - "Afairesi".
echo.
pause
exit /b 0

:stop
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'wscript.exe' -and $_.CommandLine -like '*SF-Kentro-Worker.vbs*') -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*worker.js*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
exit /b 0
