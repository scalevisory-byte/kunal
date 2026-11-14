# BOOKNFLY HRMS - replace the dashboard with a newer build.
#
# Use this when only the SCREENS changed, not the server. It swaps one
# folder and restarts the app. Your data is not touched: the database,
# the uploads and backend\.env all live outside app\backend\public.
#
# How:
#   1. Put this file and the "public-new" folder ANYWHERE, together.
#   2. Right-click this file -> Run with PowerShell.
#
# It finds the running HRMS by asking Windows where the BNFHRMS scheduled
# task points, so it does not matter which folder you put this in - and it
# cannot update some other copy of the app by mistake.
#
# PLAIN ASCII ONLY - Windows PowerShell 5.1 reads a BOM-less UTF-8 file as
# ANSI, so one accented character can break the whole script.

param(
  [string]$Port = '3002',
  [string]$TaskName = 'BNFHRMS'
)

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

# Everything below runs inside try/finally.
#
# WITHOUT this the window vanishes the instant anything goes wrong: a
# `throw` ends the script, the script was the only thing the window was
# running, and Windows closes it - so the one line explaining the problem
# is on screen for a few milliseconds. That is exactly what happened the
# first time this was used, and it looks like "PowerShell just closes".
$ErrorActionPreference = 'Stop'
$failed = $null
try {

  $here = $PSScriptRoot

  # ---- where is the new dashboard ------------------------------------
  #
  # Accept either shape: "public-new\..." as zipped, or a plain "public"
  # if it was extracted some other way.
  $new = $null
  foreach ($c in @('public-new', 'public')) {
    $p = Join-Path $here $c
    if (Test-Path (Join-Path $p 'index.html')) { $new = $p; break }
    # Some unzippers add one more level: public-new\public\index.html
    $inner = Join-Path $p 'public'
    if (Test-Path (Join-Path $inner 'index.html')) { $new = $inner; break }
  }
  if (-not $new) {
    throw "Cannot find the new dashboard next to this script.`r`n" +
          "  Looked in: $here`r`n" +
          "  Expected a folder 'public-new' containing index.html.`r`n" +
          "  Extract BNFHRMS-dashboard-update.zip into the same folder as this file."
  }
  if (-not (Test-Path (Join-Path $new 'assets'))) {
    throw "$new has no 'assets' folder - that is not a dashboard build."
  }
  Write-Host "New dashboard: $new"

  # ---- where is the HRMS actually installed --------------------------
  #
  # Asked of Windows, not guessed from this script's folder. There is more
  # than one copy of the app on this server (an older attempt is still
  # lying about), and updating the wrong one changes nothing while
  # reporting success - which is worse than failing.
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $backend = $null
  if ($task) {
    $act = $task.Actions | Select-Object -First 1
    # Registered as:  node.exe  "...\app\backend\src\index.js"
    $entry = ($act.Arguments -replace '"', '').Trim()
    if ($entry -and (Test-Path $entry)) {
      $backend = Split-Path -Parent (Split-Path -Parent $entry)   # ...\app\backend
    } elseif ($act.WorkingDirectory) {
      $backend = $act.WorkingDirectory
    }
  }
  if (-not $backend) {
    # No task registered yet - fall back to this folder's own layout.
    $guess = Join-Path $here 'app\backend'
    if (Test-Path (Join-Path $guess 'src\index.js')) { $backend = $guess }
  }
  if (-not $backend -or -not (Test-Path (Join-Path $backend 'src\index.js'))) {
    throw "Cannot find the installed HRMS.`r`n" +
          "  No scheduled task called '$TaskName' points at a backend,`r`n" +
          "  and there is no app\backend\src\index.js beside this script.`r`n" +
          "  Is the app installed? Try: Get-ScheduledTask -TaskName $TaskName"
  }
  $public = Join-Path $backend 'public'
  Write-Host "Updating:      $public"
  Write-Host ''

  # ---- swap it -------------------------------------------------------
  Write-Host 'Stopping the HRMS...'
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3

  # The old folder is kept, not deleted, until the new one is in place -
  # so a failure half way through leaves a working dashboard rather than
  # an empty folder and a blank screen.
  $backup = Join-Path (Split-Path -Parent $public) ('public-old-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  if (Test-Path $public) {
    Write-Host "Keeping the old one as $(Split-Path -Leaf $backup)"
    Move-Item $public $backup
  }

  try {
    Write-Host 'Putting the new dashboard in...'
    # Asset filenames carry a content hash, so the new build has DIFFERENT
    # names. This is a replace, not a merge: copying over the old folder
    # would leave both sets sitting there.
    New-Item -ItemType Directory -Path $public | Out-Null
    Copy-Item (Join-Path $new '*') $public -Recurse -Force
  } catch {
    Write-Host 'That failed - putting the old dashboard back.'
    if (Test-Path $public) { Remove-Item $public -Recurse -Force }
    if (Test-Path $backup) { Move-Item $backup $public }
    throw
  }

  Write-Host 'Starting the HRMS...'
  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

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
    Write-Host "  The old one is in $(Split-Path -Leaf $backup) if it is ever needed."
    Write-Host '  Delete that folder once the new one looks right.'
  } else {
    Write-Host "  The files are in place, but it did not answer on port $Port."
    Write-Host "  Check:  Get-ScheduledTaskInfo -TaskName $TaskName"
  }

} catch {
  $failed = $_
  Write-Host ''
  Write-Host '  ---- IT DID NOT WORK ----' -ForegroundColor Red
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ''
  Write-Host '  Nothing was changed, or the old dashboard was put back.'
  Write-Host '  Send a photo of this window.'
} finally {
  Write-Host ''
  Read-Host 'Press Enter to close'
}
