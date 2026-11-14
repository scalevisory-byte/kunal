# BOOKNFLY HRMS - replace the dashboard with a newer build.
#
# Use this when only the SCREENS changed, not the server. It swaps one
# folder and restarts the app. Your data is not touched: the database,
# the uploads and backend\.env are all outside app\backend\public.
#
# How:
#   1. Extract the update zip INTO this same folder (the one holding
#      INSTALL.ps1). You should end up with "public-new" beside it.
#   2. Right-click this file -> Run with PowerShell.
#
# PLAIN ASCII ONLY - Windows PowerShell 5.1 reads a BOM-less UTF-8 file as
# ANSI, so one accented character can break the whole script.

param(
  [string]$Port = '3002',
  [string]$TaskName = 'BNFHRMS'
)

$ErrorActionPreference = 'Stop'

# ---- Administrator ----------------------------------------------------
$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Asking for Administrator...'
  Start-Process powershell -Verb RunAs -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
    '-Port', $Port, '-TaskName', $TaskName
  )
  return
}

$here   = $PSScriptRoot
$public = Join-Path $here 'app\backend\public'
$new    = Join-Path $here 'public-new'

# The zip may extract as "public-new\public\..." depending on how it is
# opened, so accept either shape rather than failing on a detail nobody
# can see.
if (-not (Test-Path $new)) {
  $alt = Join-Path $here 'public'
  if ((Test-Path $alt) -and -not (Test-Path (Join-Path $alt 'assets'))) {
    throw "Found 'public' but it has no assets folder. Extract the update zip again."
  }
  if (Test-Path $alt) { $new = $alt } else {
    throw "Cannot find 'public-new' in $here  - extract the update zip into this folder first."
  }
}
$inner = Join-Path $new 'public'
if ((Test-Path $inner) -and (Test-Path (Join-Path $inner 'index.html'))) { $new = $inner }

if (-not (Test-Path (Join-Path $new 'index.html'))) {
  throw "$new has no index.html - that is not a dashboard build."
}
if (-not (Test-Path (Join-Path $new 'assets'))) {
  throw "$new has no assets folder - that is not a dashboard build."
}
if (-not (Test-Path (Join-Path $here 'app\backend\src\index.js'))) {
  throw "This is not the BNFHRMS folder - app\backend\src\index.js is not here."
}

Write-Host ''
Write-Host 'Stopping the HRMS...'
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Keep the old one until the new one is in place, so a failure half way
# through leaves a working dashboard rather than an empty folder.
$backup = Join-Path $here ('public-old-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path $public) {
  Write-Host "Keeping the old dashboard as $(Split-Path -Leaf $backup)"
  Move-Item $public $backup
}

try {
  Write-Host 'Putting the new dashboard in...'
  # The asset filenames carry a content hash, so the new build has
  # DIFFERENT names. Copying over the old folder would leave both sets
  # sitting there; this is a replace, not a merge.
  New-Item -ItemType Directory -Path $public | Out-Null
  Copy-Item (Join-Path $new '*') $public -Recurse -Force
} catch {
  Write-Host 'That failed - putting the old dashboard back.'
  if (Test-Path $public) { Remove-Item $public -Recurse -Force }
  if (Test-Path $backup) { Move-Item $backup $public }
  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  throw
}

Write-Host 'Starting the HRMS...'
Start-ScheduledTask -TaskName $TaskName

$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/healthz" -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
}

Write-Host ''
if ($ok) {
  Write-Host '  Done. The new dashboard is up:'
  Write-Host "    http://localhost:$Port"
  Write-Host ''
  Write-Host '  In the browser press Ctrl+F5 once - otherwise it shows you'
  Write-Host '  the page it still has saved from last time.'
  Write-Host ''
  Write-Host "  The old dashboard is in $(Split-Path -Leaf $backup) if it is ever needed."
  Write-Host '  You can delete that folder once the new one looks right.'
} else {
  Write-Host "  It did not answer on port $Port."
  Write-Host "  Check:  Get-ScheduledTaskInfo -TaskName $TaskName"
  Write-Host "  Logs:   $(Join-Path $here 'logs')"
}
Write-Host ''
Read-Host 'Press Enter to close'
