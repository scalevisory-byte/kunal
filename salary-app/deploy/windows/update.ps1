# Brings down a new version and restarts.
#
# Right-click -> Run with PowerShell. It stops the service FIRST, because
# Windows locks the files of a running app and npm then fails halfway, and
# it starts it again in a finally so a failed build never leaves the office
# with no HRMS.
#
# Your data is in the data folder and is never touched by this.
#
# PLAIN ASCII ONLY - see the note at the top of setup.ps1.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$service = 'BNFHRMS'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$repo = Split-Path -Parent $root                               # the clone

$was = Get-Service -Name $service -ErrorAction SilentlyContinue
if ($was -and $was.Status -ne 'Stopped') {
  Write-Host 'Stopping the service...'
  Stop-Service -Name $service -Force
  Start-Sleep -Seconds 3
}

try {
  Push-Location $repo
  try {
    Write-Host 'Fetching the new version...'
    & git fetch --all --prune
    if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
    $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
    & git reset --hard "origin/$branch"
    if ($LASTEXITCODE -ne 0) { throw 'git reset failed' }
    Write-Host "Now on: $(& git log --oneline -1)"
  } finally { Pop-Location }

  & (Join-Path $PSScriptRoot 'setup.ps1')
} finally {
  # Whatever happened above, the office gets its HRMS back.
  if ($was) {
    Write-Host 'Starting the service again...'
    Start-Service -Name $service
    Start-Sleep -Seconds 4
    $now = Get-Service -Name $service
    Write-Host "Service is $($now.Status)"
  }
}
