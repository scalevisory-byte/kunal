# Runs the HRMS as a Windows service under NSSM, so it starts with the
# machine and comes back if it ever stops.
#
# Needs Administrator. install-all.ps1 elevates itself and calls this.
#
# PLAIN ASCII ONLY - see the note at the top of setup.ps1.

$ErrorActionPreference = 'Stop'

$service = 'BNFHRMS'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # ...\salary-app
$backend = Join-Path $root 'backend'
$nssm = Join-Path $PSScriptRoot 'nssm.exe'

if (-not (Test-Path $nssm)) {
  throw "nssm.exe is not in $PSScriptRoot - run install-all.ps1, which fetches it."
}

# The same Node setup.ps1 settled on: the private copy if there is one,
# otherwise the server's. A service runs as LocalSystem, which does not see
# a per-user PATH, so this is written out in full rather than left to PATH.
$private = Join-Path $root '.node\node.exe'
if (Test-Path $private) { $nodeExe = $private }
else {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'No Node found. Run setup.ps1 first.' }
  $nodeExe = $cmd.Source
}

$entry = Join-Path $backend 'src\index.js'
if (-not (Test-Path $entry)) { throw "Cannot find $entry" }

$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null

$existing = Get-Service -Name $service -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Service $service exists - stopping it so its files can be replaced."
  if ($existing.Status -ne 'Stopped') { Stop-Service -Name $service -Force }
  & $nssm remove $service confirm | Out-Null
  Start-Sleep -Seconds 2
}

Write-Host "Installing the service $service..."
& $nssm install $service $nodeExe $entry
& $nssm set $service AppDirectory $backend
& $nssm set $service DisplayName 'BOOKNFLY HRMS'
& $nssm set $service Description 'Salary, attendance and leave. Serves the dashboard on the port in backend\.env.'
& $nssm set $service Start SERVICE_AUTO_START
# Come back if it ever exits, but back off so a boot loop does not spin.
& $nssm set $service AppExit Default Restart
& $nssm set $service AppRestartDelay 5000
& $nssm set $service AppStdout (Join-Path $logs 'hrms.log')
& $nssm set $service AppStderr (Join-Path $logs 'hrms.err.log')
& $nssm set $service AppRotateFiles 1
& $nssm set $service AppRotateOnline 1
& $nssm set $service AppRotateBytes 10485760

Start-Service -Name $service
Start-Sleep -Seconds 4
$now = Get-Service -Name $service

Write-Host ''
Write-Host "Service: $($now.Name) is $($now.Status)"
Write-Host "Logs:    $logs"

# Say whether it actually answers, not merely whether Windows started it.
$port = 3002
$envFile = Join-Path $backend '.env'
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern '^PORT=(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
}
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$port/healthz" -TimeoutSec 10
  Write-Host "Answering on http://localhost:$port  ->  $($r.Content)"
} catch {
  Write-Host "It is not answering on port $port yet. Look in $logs\hrms.err.log"
}
