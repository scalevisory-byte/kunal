# BOOKNFLY HRMS - update the app to a newer build.
#
# It swaps the code and the screens and restarts. YOUR DATA IS NOT
# TOUCHED: the database, the uploads, backend\.env and the installed
# packages all live outside the folders this replaces.
#
# It updates whichever of these the update carries, and ignores the rest:
#
#   public-new  -> app\backend\public    the screens
#   src-new     -> app\backend\src       the server
#   shared-new  -> app\shared            the calculations
#
# How:
#   1. Put this file and those folders ANYWHERE, together.
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

  # ---- what has this update got in it --------------------------------
  #
  # Each part names the folder it arrives in, the folder it replaces under
  # the install, and a file that must be inside it - so half an extraction
  # cannot wipe a working folder and put nothing back.
  $parts = @(
    @{ From = 'public-new'; To = 'backend\public'; Proof = 'index.html'; What = 'the screens' },
    @{ From = 'src-new';    To = 'backend\src';    Proof = 'index.js';   What = 'the server' },
    @{ From = 'shared-new'; To = 'shared';          Proof = 'calc.js';    What = 'the calculations' }
  )
  $found = @()
  foreach ($part in $parts) {
    $p = Join-Path $here $part.From
    if (-not (Test-Path $p)) { continue }
    # Some unzippers add one more level.
    $inner = Join-Path $p (Split-Path -Leaf $part.To)
    if (Test-Path (Join-Path $inner $part.Proof)) { $p = $inner }
    if (-not (Test-Path (Join-Path $p $part.Proof))) {
      throw "$p has no $($part.Proof) in it - that is not $($part.What). Extract the update zip again."
    }
    $found += @{ Path = $p; To = $part.To; What = $part.What }
  }
  if (-not $found.Count) {
    throw "This update has nothing in it.`r`n" +
          "  Looked in: $here`r`n" +
          "  Expected at least one of: public-new, src-new, shared-new.`r`n" +
          "  Extract the update zip into the same folder as this file."
  }
  Write-Host ("This update carries: " + (($found | ForEach-Object { $_.What }) -join ', '))

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
  $root = Split-Path -Parent $backend   # ...\app
  Write-Host "Updating:      $root"
  Write-Host ''

  # ---- swap it -------------------------------------------------------
  Write-Host 'Stopping the HRMS...'
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3

  # Every old folder is kept, not deleted, until all the new ones are in
  # place - so a failure half way through puts the whole lot back rather
  # than leaving the office with half an app.
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $moved = @()
  try {
    foreach ($f in $found) {
      $to = Join-Path $root $f.To
      $backup = "$to-old-$stamp"
      if (Test-Path $to) {
        Write-Host "  $($f.To)  ->  kept as $(Split-Path -Leaf $backup)"
        Move-Item $to $backup
        $moved += @{ To = $to; Backup = $backup }
      }
      # A replace, not a merge. The screens' filenames carry a content hash
      # so the new build has DIFFERENT names, and a merge would leave both
      # sets sitting there; a stale .js left in src would do worse.
      New-Item -ItemType Directory -Path $to -Force | Out-Null
      Copy-Item (Join-Path $f.Path '*') $to -Recurse -Force
    }
  } catch {
    Write-Host 'That failed - putting the old app back.'
    foreach ($m in $moved) {
      if (Test-Path $m.To) { Remove-Item $m.To -Recurse -Force }
      if (Test-Path $m.Backup) { Move-Item $m.Backup $m.To }
    }
    throw
  }
  $backup = if ($moved.Count) { $moved[0].Backup } else { '' }

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
    Write-Host '  Done. The new version is up:'
    Write-Host "    http://localhost:$Port"
    Write-Host ''
    Write-Host '  In the browser press Ctrl+F5 once - otherwise it shows you'
    Write-Host '  the page it still has saved from last time.'
    Write-Host ''
    Write-Host '  The old folders are kept beside the new ones, named -old-<date>,'
    Write-Host '  if they are ever needed. Delete them once this looks right.'
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
  Write-Host '  Nothing was changed, or the old app was put back.'
  Write-Host '  Send a photo of this window.'
} finally {
  Write-Host ''
  Read-Host 'Press Enter to close'
}
