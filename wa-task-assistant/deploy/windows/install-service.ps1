# WA Tasks - run as a Windows service, so it starts with the server and comes
# back by itself if it ever stops.
#
# Needs NSSM (https://nssm.cc/download): put nssm.exe (the win64 one) in this
# folder, or anywhere on PATH. Run as Administrator:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install-service.ps1

$ErrorActionPreference = 'Stop'
$name = 'WATasks'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$backend = Join-Path $root 'backend'

$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) { $nssm = Join-Path $PSScriptRoot 'nssm.exe' }
if (-not (Test-Path $nssm)) { throw 'nssm.exe not found. Download it from https://nssm.cc/download and put the win64 nssm.exe in deploy\windows.' }
if (-not (Test-Path (Join-Path $backend '.env'))) { throw 'backend\.env is missing. Run setup.ps1 first.' }

$node = (Get-Command node).Source
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

# Replace an earlier install cleanly.
if (Get-Service -Name $name -ErrorAction SilentlyContinue) {
  & $nssm stop $name | Out-Null
  & $nssm remove $name confirm | Out-Null
}

& $nssm install $name $node 'src\index.js'
& $nssm set $name AppDirectory $backend
& $nssm set $name DisplayName 'WA Tasks'
& $nssm set $name Start SERVICE_AUTO_START
& $nssm set $name AppStdout (Join-Path $logs 'out.log')
& $nssm set $name AppStderr (Join-Path $logs 'error.log')
& $nssm set $name AppRotateFiles 1
& $nssm set $name AppRotateBytes 10485760
# If it stops, wait 10 s and start it again.
& $nssm set $name AppExit Default Restart
& $nssm set $name AppRestartDelay 10000
& $nssm start $name

Write-Host ''
Write-Host "Service '$name' installed and started. Open http://localhost:3001" -ForegroundColor Green
Write-Host "Logs: $logs"
