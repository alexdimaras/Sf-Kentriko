@echo off
setlocal
chcp 65001 >nul
title SF Kentro - anevasma / enimerosi ston diakomisti (cloud)
cd /d "%~dp0"
rem Anevazei to programma ston dorean diakomisti (Oracle Cloud Always Free, Ubuntu), to egkathista kai to ksekinaei.
rem Ksanatrexei gia kathe nea ekdosi: ta dedomena menoun ston diakomisti. Odigies: DIAKOMISTIS-CLOUD.txt
if not exist "app\server.js" goto nofiles
if not exist "deploy\install-server.sh" goto nofiles
where ssh >nul 2>nul || goto nossh
where tar >nul 2>nul || goto nossh

set "CFG=%~dp0deploy\.diakomistis.cmd"
set "SFK_IP="
set "SFK_KEY="
set "SFK_HOSTNAME="
if exist "%CFG%" call "%CFG%"

echo.
echo  SF Kentro - anevasma ston diakomisti (cloud)
echo  --------------------------------------------
echo  Enter = krata ayto pou fainetai mesa se [ ]
echo.
set "IN="
set /p "IN=Dimosia IP tou diakomisti, p.x. 130.61.22.10 [%SFK_IP%]: "
if defined IN set "SFK_IP=%IN%"
set "IN="
set /p "IN=Arxeio kleidiou .key - syre to edo [%SFK_KEY%]: "
if defined IN set "SFK_KEY=%IN:"=%"
set "IN="
set /p "IN=Dieuthynsi, p.x. kentro.example.gr [%SFK_HOSTNAME%]: "
if defined IN set "SFK_HOSTNAME=%IN%"
if not defined SFK_IP goto missing
if not defined SFK_KEY goto missing
if not defined SFK_HOSTNAME goto missing
if not exist "%SFK_KEY%" goto nokey

rem To ssh ton Windows den dexetai kleidi pou to diavazoun kai alloi: idiotiko antigrafo mono gia ayton ton xristi
set "KEY=%USERPROFILE%\.ssh\sf-kentro-cloud.key"
if /i "%SFK_KEY%"=="%KEY%" goto keyready
if not exist "%USERPROFILE%\.ssh" mkdir "%USERPROFILE%\.ssh"
if exist "%KEY%" icacls "%KEY%" /grant:r "%USERNAME%:F" >nul
copy /y "%SFK_KEY%" "%KEY%" >nul || goto fail
icacls "%KEY%" /inheritance:r /grant:r "%USERNAME%:R" >nul || goto fail
set "SFK_KEY=%KEY%"
:keyready
> "%CFG%" echo set "SFK_IP=%SFK_IP%"
>> "%CFG%" echo set "SFK_KEY=%SFK_KEY%"
>> "%CFG%" echo set "SFK_HOSTNAME=%SFK_HOSTNAME%"

echo.
echo [1/3] Paketo me to programma...
set "PKG=%TEMP%\sf-kentro-cloud.tgz"
tar -czf "%PKG%" --exclude=node_modules --exclude=.env --exclude=.diakomistis.cmd app deploy || goto fail
echo [2/3] Anevasma ston diakomisti %SFK_IP%...
scp -i "%SFK_KEY%" -o StrictHostKeyChecking=accept-new "%PKG%" ubuntu@%SFK_IP%:sf-kentro-cloud.tgz || goto fail
echo [3/3] Egkatastasi / enimerosi - tin proti fora 5-10 lepta...
ssh -t -i "%SFK_KEY%" -o StrictHostKeyChecking=accept-new ubuntu@%SFK_IP% "mkdir -p sf-kentro && tar -xzf sf-kentro-cloud.tgz -C sf-kentro && rm -f sf-kentro-cloud.tgz && sed -i 's/\r$//' sf-kentro/deploy/install-server.sh && sudo bash sf-kentro/deploy/install-server.sh %SFK_HOSTNAME%" || goto fail
del "%PKG%" >nul 2>nul
echo.
echo Teleiose. Anoixe se olous tous ypologistes kai ta kinita: https://%SFK_HOSTNAME%/
pause
exit /b 0

:nofiles
echo Den vrethikan oi fakeloi app kai deploy. Trexe to mesa apo ton fakelo SF-Kentro.
pause
exit /b 1
:nossh
echo Leipei to ssh i to tar ton Windows. Windows 10/11: Rythmiseis - Efarmoges - Proairetikes dynatotites - OpenSSH Client.
pause
exit /b 1
:missing
echo Xreiazontai kai ta tria: IP, kleidi kai dieuthynsi.
pause
exit /b 1
:nokey
echo Den vrethike to kleidi:
echo "%SFK_KEY%"
pause
exit /b 1
:fail
echo.
echo Kati den pige kala - des to minyma pio pano. Odigies: DIAKOMISTIS-CLOUD.txt
pause
exit /b 1
