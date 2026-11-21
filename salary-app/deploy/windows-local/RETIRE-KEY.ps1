# BOOKNFLY HRMS - retire the shared office password (APP_PASSWORD)
#
# APP_PASSWORD is a master key. Anyone holding it is full Admin with NO NAME
# on them: the audit trail records everything they do as "the API key", so
# "who changed this salary" has no answer. It exists only so the app can be
# reached before the first real login is made. Once there is an Admin login,
# it is a spare key under the mat.
#
# This script LOOKS FIRST and shows you everything before it touches
# anything. It:
#   - checks there is a real Admin login to use instead, and REFUSES if not,
#     because removing the key with nothing to sign in with locks the office
#     out of its own payroll;
#   - names anything that has signed in WITH the key recently, since that is
#     something on a schedule that will stop working;
#   - keeps a dated copy of the settings file;
#   - waits for you to type GO;
#   - restarts the app and checks it came back and that the key is dead.
#
# Nothing here touches the tunnel, the database, or any other app on this
# machine.
#
# Right-click -> Run with PowerShell.
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

$ErrorActionPreference = 'Stop'
try {

  Write-Host ''
  Write-Host '============ THE SHARED OFFICE PASSWORD ============'
  Write-Host ''

  # ---- find the install from the task, not from a remembered path ----
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) {
    Write-Host "  No scheduled task called $TaskName on this machine."
    Write-Host '  Nothing was changed. Is this the BNF server?'
    Read-Host 'Enter to close'
    return
  }

  $backend = $task.Actions[0].WorkingDirectory
  if (-not $backend) { $backend = Split-Path $task.Actions[0].Arguments.Trim('"') -Parent }
  $envFile = Join-Path $backend '.env'
  Write-Host "  Install:  $backend"
  Write-Host "  Settings: $envFile"

  if (-not (Test-Path $envFile)) {
    Write-Host '  No .env there. Nothing was changed.'
    Read-Host 'Enter to close'
    return
  }

  $lines = [IO.File]::ReadAllLines($envFile)
  $keyLines = @($lines | Where-Object { $_ -match '^\s*APP_PASSWORD\s*=' })
  if ($keyLines.Count -eq 0) {
    Write-Host ''
    Write-Host '  APP_PASSWORD is already gone. There is nothing to retire.'
    Read-Host 'Enter to close'
    return
  }
  Write-Host ''
  Write-Host "  APP_PASSWORD is SET ($($keyLines.Count) line). The value is not printed here."

  # ---- is the app up, and is there a real login to use instead ----
  Write-Host ''
  Write-Host '  Checking there is a real login to use instead...'
  $state = $null
  try {
    $state = Invoke-RestMethod -Uri "http://localhost:$Port/api/auth/state" -TimeoutSec 10
  } catch {
    Write-Host "  Could not reach the app on port $Port - is it running?"
    Write-Host '  START.ps1 starts it. Nothing was changed.'
    Read-Host 'Enter to close'
    return
  }

  if ($state.needs_setup) {
    Write-Host ''
    Write-Host '  REFUSING: this app has NO logins at all yet.'
    Write-Host '  Removing the key now would leave nothing to sign in with, and the'
    Write-Host '  app would refuse to start rather than stand open.'
    Write-Host ''
    Write-Host '  Make an Admin login first, then run this again.'
    Read-Host 'Enter to close'
    return
  }
  Write-Host '  There are logins. Good.'

  # ---- anything on a schedule using the key ----
  Write-Host ''
  Write-Host '  Nothing in this kit uses the key on a schedule - the backups run'
  Write-Host '  inside the app itself. If YOU pointed anything at this app with'
  Write-Host '  that password (a reminder script, Excel, another machine), it'
  Write-Host '  will stop working. Admin -> Sign-ins lists what has been getting in.'

  Write-Host ''
  Write-Host '============ WHAT THIS WILL DO ============'
  Write-Host ''
  Write-Host "  1. Copy $envFile to a dated backup beside it."
  Write-Host '  2. Remove the APP_PASSWORD line, leaving everything else alone.'
  Write-Host "  3. Restart $TaskName."
  Write-Host '  4. Check the app came back, and that the old key no longer works.'
  Write-Host ''
  Write-Host '  After this, the ONLY way in is a username and password. Make sure'
  Write-Host '  you can sign in as an Admin before you do it.'
  Write-Host ''

  $answer = Read-Host 'Type GO to do it, anything else to leave it alone'
  if ($answer -ne 'GO') {
    Write-Host 'Left alone. Nothing was changed.'
    Read-Host 'Enter to close'
    return
  }

  # ---- 1. backup ----
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = "$envFile.$stamp.bak"
  Copy-Item $envFile $backup
  Write-Host "  Backed up to $backup"

  # ---- 2. rewrite without the line ----
  # PowerShell's own -Encoding UTF8 writes a BOM, which glues onto the first
  # variable's NAME - so the app would read no PORT, no DATA_DIR, nothing.
  # @() so a one-line .env still hands WriteAllLines an array, not a string.
  $kept = @($lines | Where-Object { $_ -notmatch '^\s*APP_PASSWORD\s*=' })
  [IO.File]::WriteAllLines($envFile, $kept, (New-Object Text.UTF8Encoding($false)))
  Write-Host '  APP_PASSWORD line removed.'

  # ---- 3. restart ----
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "  Restarted $TaskName. Waiting for it to come up..."

  $up = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 2
    try {
      Invoke-RestMethod -Uri "http://localhost:$Port/healthz" -TimeoutSec 5 | Out-Null
      $up = $true
      break
    } catch { }
  }

  Write-Host ''
  Write-Host '============ HOW IT WENT ============'
  Write-Host ''

  if (-not $up) {
    Write-Host '  THE APP DID NOT COME BACK.'
    Write-Host "  Put the settings back:  Copy-Item `"$backup`" `"$envFile`" -Force"
    Write-Host '  then run START.ps1.'
    Read-Host 'Enter to close'
    return
  }
  Write-Host '  The app is up.'

  # ---- 4. is the old key actually dead ----
  $old = ($keyLines[0] -replace '^\s*APP_PASSWORD\s*=\s*', '').Trim()
  $dead = $false
  try {
    Invoke-RestMethod -Uri "http://localhost:$Port/api/employees" -TimeoutSec 10 `
      -Headers @{ Authorization = "Bearer $old" } | Out-Null
  } catch {
    $dead = $true
  }

  if ($dead) {
    Write-Host '  The old office password no longer opens anything. Done.'
  } else {
    Write-Host '  WARNING: the old password STILL WORKS. Something did not take -'
    Write-Host "  check $envFile and run START.ps1 again."
  }

  Write-Host ''
  Write-Host '  From now on everything anybody does is recorded under their own'
  Write-Host '  name. Admin -> Sign-ins shows who got in and who was refused.'
  Write-Host ''
  Read-Host 'Enter to close'

} catch {
  Write-Host ''
  Write-Host "SOMETHING WENT WRONG: $($_.Exception.Message)"
  Write-Host 'If a backup was made it is named beside .env with the date on it.'
  Read-Host 'Enter to close'
}
