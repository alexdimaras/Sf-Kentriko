'use strict';
// SF Κέντρο — the one-click installer of a computer: a small .cmd file made by the program for one computer, with the
// address of the program and a one-time pairing code inside. Double click → it downloads the program (GitHub zip, with
// its own Node), connects to the cloud, sets itself to start with Windows, and starts STOPPED (it uses nothing until a
// person switches it on in Ρυθμίσεις → Σύστημα). Later versions come by themselves (lib/selfupdate.js).
// No administrator rights: everything under %LOCALAPPDATA%\SF-Kentro and the user's Startup folder.

const SAFE = /^[\w:/.%-]+$/;

/** → the text of the .cmd (Windows line ends). Throws when a value could break out of the script. */
function cmdText({ server, code, zip, until }) {
  for (const [k, v] of Object.entries({ server, code, zip })) if (!v || !SAFE.test(String(v))) throw new Error('Άκυρη τιμή για το αρχείο εγκατάστασης: ' + k);
  if (!/^https:\/\//.test(server) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(server)) throw new Error('Η διεύθυνση του προγράμματος πρέπει να είναι https.');
  if (!/^https:\/\/github\.com\//.test(zip)) throw new Error('Το πρόγραμμα κατεβαίνει μόνο από το GitHub.');
  const L = [
    '@echo off',
    'rem SF Kentro - aytomati egkatastasi kai syndesi aytou tou ypologisti me to programma.',
    `rem Periexei kodiko syzeuxis mias xrisis (isxyei mexri ${String(until || '').replace(/[^\w:. -]/g, '')}). Mi to steileis se allous.`,
    'rem Den xreiazetai diaxeiristis ton Windows. Den grafei pote sta sites.',
    'title SF Kentro - Egkatastasi',
    'chcp 65001 >nul',
    `set "SERVER=${server}"`,
    `set "CODE=${code}"`,
    `set "ZIPURL=${zip}"`,
    'set "DEST=%LOCALAPPDATA%\\SF-Kentro"',
    'set "TMPZ=%TEMP%\\sf-kentro-setup.zip"',
    'set "TMPD=%TEMP%\\sf-kentro-setup"',
    'set "STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\SF-Kentro-Worker.vbs"',
    'echo.',
    'echo  SF Kentro - egkatastasi ston ypologisti (aytomata, 2-5 lepta)',
    'echo  ============================================================',
    'call :stop',
    // ALWAYS the current program, also over an older installation (seen 24/11: an installed computer kept its worker
    // 2026-11-23b because this step was skipped when the folder existed — «run the installer once» changed nothing)
    'timeout /t 2 /nobreak >nul',
    'echo  1/3 Katevasma tis trexousas ekdosis tou programmatos...',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference=\'Stop\'; $ProgressPreference=\'SilentlyContinue\'; [Net.ServicePointManager]::SecurityProtocol=\'Tls12\'; Invoke-WebRequest -UseBasicParsing -Uri $env:ZIPURL -OutFile $env:TMPZ; if (Test-Path $env:TMPD) { Remove-Item -Recurse -Force $env:TMPD }; Expand-Archive -Force -LiteralPath $env:TMPZ -DestinationPath $env:TMPD; $src = Get-ChildItem $env:TMPD | Select-Object -First 1; New-Item -ItemType Directory -Force -Path $env:DEST | Out-Null; Copy-Item -Recurse -Force (Join-Path $src.FullName \'*\') $env:DEST"',
    'if errorlevel 1 goto nodl',
    'del /q "%TMPZ%" >nul 2>&1',
    'rmdir /s /q "%TMPD%" >nul 2>&1',
    ':connect',
    'echo  2/3 Syndesi me to programma...',
    '"%DEST%\\runtime\\node.exe" "%DEST%\\app\\worker.js" ensure "%SERVER%" "%CODE%"',
    'if errorlevel 1 goto fail',
    'echo  3/3 Ekkinisi me ta Windows, sto paraskinio...',
    '> "%STARTUP%" echo Set sh = CreateObject("WScript.Shell")',
    '>> "%STARTUP%" echo Do',
    '>> "%STARTUP%" echo   rc = sh.Run("""%DEST%\\runtime\\node.exe"" ""%DEST%\\app\\worker.js""", 0, True)',
    '>> "%STARTUP%" echo   If rc = 2 Or rc = 3 Then Exit Do',
    '>> "%STARTUP%" echo   If rc = 4 Then WScript.Sleep 3000 Else WScript.Sleep 60000',
    '>> "%STARTUP%" echo Loop',
    'start "" wscript.exe "%STARTUP%"',
    'echo.',
    'echo  ETOIMO. O ypologistis syndethike me to programma.',
    'echo  Einai STAMATIMENOS: den xrisimopoiei poroys mexri na ton anoixeis',
    'echo  sto programma: Rythmiseis - Systima - "Na doulevei".',
    'echo  Oi nees ekdoseis erxontai mones tous.',
    'echo.',
    'pause',
    'exit /b 0',
    ':nodl',
    // the download failed: an installed program still runs (said plainly: it is NOT the new version)
    'if not exist "%DEST%\\app\\worker.js" goto fail',
    'echo  PROSOXI: i nea ekdosi den katevike (internet;). Synexizei me tin palia - ksanatrexe to arxeio argotera.',
    'goto connect',
    ':fail',
    'echo.',
    'echo  Den oloklirothike. Elegxe to internet kai ksanatrexe to arxeio.',
    'echo  An o kodikos elixe: sto programma, Rythmiseis - Systima - "Arxeio egkatastasis" ksana.',
    'echo.',
    'pause',
    'exit /b 1',
    ':stop',
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq \'wscript.exe\' -and $_.CommandLine -like \'*SF-Kentro-Worker.vbs*\') -or ($_.Name -eq \'node.exe\' -and $_.CommandLine -like \'*worker.js*\') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1',
    'exit /b 0',
  ];
  return L.join('\r\n') + '\r\n';
}

module.exports = { cmdText };
