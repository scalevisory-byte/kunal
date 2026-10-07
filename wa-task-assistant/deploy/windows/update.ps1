# WA Tasks - take the latest version from GitHub and restart.
#   powershell -ExecutionPolicy Bypass -File deploy\windows\update.ps1
# Data (tasks, WhatsApp login) lives in the data folder and is not touched.

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) { $nssm = Join-Path $PSScriptRoot 'nssm.exe' }

# Stop first: Windows locks the files of a running app, and reinstalling
# packages under it fails.
& $nssm stop WATasks | Out-Null
try {
  Push-Location $root
  git pull
  if ($LASTEXITCODE -ne 0) { throw 'git pull failed' }
  Pop-Location
  & (Join-Path $PSScriptRoot 'setup.ps1')
} finally {
  # Started again even if the update failed, so a bad pull never leaves it off.
  & $nssm start WATasks | Out-Null
}
Write-Host 'Updated and restarted.' -ForegroundColor Green
