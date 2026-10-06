@echo off
rem Same as `node lab.mjs ...` on Windows, for a machine without Node.js 22+: fetches it once into .lab-node\ (no admin needed).
rem Double-clicked (no arguments): the first-time guide, `node lab.mjs start`.
setlocal
set "TOP=%~dp0"
node -e "process.exit(+process.versions.node.split('.')[0]>=22?0:1)" >nul 2>&1 && (node "%TOP%lab.mjs" %* & (if "%~1"=="" pause) & exit /b)
if not exist "%TOP%.lab-node\node.exe" (
  echo fetching Node.js 22 into .lab-node\ ... 1>&2
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $b=($env:NODE_MIRROR,'https://nodejs.org/dist' -ne $null)[0]+'/latest-v22.x'; $a=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){'arm64'}else{'x64'}; $l=((Invoke-WebRequest -UseBasicParsing \"$b/SHASUMS256.txt\").Content -split \"`n\" | ? { $_ -match \" node-v[0-9.]+-win-$a\.zip$\" })[0]; $h,$f=$l -split '\s+'; $t=Join-Path $env:TEMP $f; Invoke-WebRequest -UseBasicParsing \"$b/$f\" -OutFile $t; if((Get-FileHash $t -Algorithm SHA256).Hash -ne $h.ToUpper()){throw 'checksum mismatch'}; Expand-Archive $t -DestinationPath \"%TOP%.lab-node.tmp\" -Force; Move-Item (Join-Path \"%TOP%.lab-node.tmp\" $f.Replace('.zip','')) \"%TOP%.lab-node\"; Remove-Item -Recurse \"%TOP%.lab-node.tmp\",$t" || (echo ERR cannot fetch Node.js 22: install it from nodejs.org 1>&2 & exit /b 1)
)
set "PATH=%TOP%.lab-node;%PATH%"
"%TOP%.lab-node\node.exe" "%TOP%lab.mjs" %*
if "%~1"=="" pause
