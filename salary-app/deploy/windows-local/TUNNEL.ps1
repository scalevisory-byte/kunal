# BOOKNFLY HRMS - its own tunnel, joined to nothing.
#
# This server already runs THREE other cloudflared processes:
#
#   service Cloudflared    senacantonfair.com -> :3100   (config file)
#   service ArrohanTunnel  erp.arrohanliving.in -> :4000 (config file)
#   E:\TAJ\cloudflared.exe TAJ                           (--token)
#
# NONE of them is touched here. No config.yml is opened, no existing
# service is stopped, started or restarted. The HRMS gets a tunnel of its
# own, so a restart of it can never blip anybody else's site and nobody
# else's restart can blip the HRMS.
#
# It runs as a SCHEDULED TASK, not with "cloudflared service install" -
# that command names its service "cloudflared", which already exists here
# and would collide. A task is also how the HRMS itself runs on this
# machine, so it is a pattern already proven on it.
#
# Before running this, in the Cloudflare dashboard:
#   Zero Trust -> Networks -> Tunnels -> Create a tunnel -> Cloudflared
#     name it BNFHRMS, then add a Public Hostname:
#     bnfhrms / scalevisory.in / HTTP / localhost:3002
#   Copy the token from the install command it shows (the long eyJ... part).
#
# Then right-click this file -> Run with PowerShell and paste the token.
#
# PLAIN ASCII ONLY - Windows PowerShell 5.1 reads a BOM-less UTF-8 file as
# ANSI, so one accented character can break the whole script.

param(
  [string]$Token = '',
  [string]$Hostname = 'bnfhrms.scalevisory.in',
  [string]$Port = '3002',
  [string]$TaskName = 'BNFHRMS-Tunnel',
  [string]$AppTask = 'BNFHRMS'
)

# ---- Administrator ----------------------------------------------------
$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Asking for Administrator...'
  Start-Process powershell -Verb RunAs -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
    '-Token', $Token, '-Hostname', $Hostname, '-Port', $Port,
    '-TaskName', $TaskName, '-AppTask', $AppTask
  )
  return
}

$ErrorActionPreference = 'Stop'
try {

  # ---- the app has to be up, or there is nothing to point at ----
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/healthz" -TimeoutSec 4
    if ($r.StatusCode -ne 200) { throw }
  } catch {
    throw "Nothing is answering on port $Port. Start the HRMS first (START.ps1)."
  }
  Write-Host "The HRMS is answering on port $Port."

  # ---- the token ----
  if (-not $Token) {
    Write-Host ''
    Write-Host 'Paste the tunnel token from the Cloudflare dashboard.'
    Write-Host 'It is the long run of letters starting eyJ, out of the install command.'
    $Token = (Read-Host 'Token').Trim()
  }
  $Token = $Token.Trim().Trim('"')
  # Sometimes the whole install command gets pasted; take the token out of it.
  if ($Token -match '(eyJ[A-Za-z0-9_\-\.=]+)') { $Token = $Matches[1] }
  if ($Token -notlike 'eyJ*') {
    throw 'That does not look like a tunnel token. It should start with eyJ.'
  }
  Write-Host ("Token looks right ({0} characters, starts {1}...)." -f $Token.Length, $Token.Substring(0, 12))

  # ---- its own copy of cloudflared ----
  #
  # Copied into the HRMS's own folder rather than borrowed from E:\cloudfare
  # or E:\TAJ. Those belong to other things; if one is moved or replaced,
  # the HRMS must not stop with it.
  $here = Split-Path -Parent $PSCommandPath
  $mine = Join-Path $here 'tunnel'
  $exe = Join-Path $mine 'cloudflared.exe'
  if (-not (Test-Path $exe)) {
    New-Item -ItemType Directory -Path $mine -Force | Out-Null
    $source = $null
    foreach ($p in @(
      'E:\cloudfare\cloudflared-windows-amd64.exe',
      'E:\TAJ\cloudflared.exe',
      'C:\cloudflared\cloudflared.exe'
    )) { if (Test-Path $p) { $source = $p; break } }
    if (-not $source) {
      $source = (Get-ChildItem C:\,D:\,E:\ -Filter 'cloudflared*.exe' -Recurse -ErrorAction SilentlyContinue |
                 Select-Object -First 1).FullName
    }
    if (-not $source) { throw 'No cloudflared.exe found on this machine to copy.' }
    Copy-Item $source $exe
    Write-Host ("Copied cloudflared from {0}" -f $source)
  }
  Write-Host ("Using its own copy: {0}" -f $exe)

  # ---- nothing else is touched, and this says so out loud ----
  Write-Host ''
  Write-Host 'Leaving these exactly as they are:'
  Get-CimInstance Win32_Service | Where-Object { $_.PathName -like '*cloudflared*' } | ForEach-Object {
    Write-Host ("  service {0}  [{1}]" -f $_.Name, $_.State)
  }
  Get-CimInstance Win32_Process -Filter "Name LIKE '%cloudflared%'" | ForEach-Object {
    Write-Host ("  pid {0}" -f $_.ProcessId)
  }
  Write-Host '  ...and every config.yml on this machine.'
  Write-Host ''

  # ---- the task ----
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Replacing the existing $TaskName task."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  $action = New-ScheduledTaskAction -Execute $exe -Argument ("tunnel run --token {0}" -f $Token) -WorkingDirectory $mine
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Started $TaskName."
  Start-Sleep -Seconds 8

  # ---- the cookie ----
  #
  # Without this the sign-in cookie is dropped over https and it reads to
  # everybody as "the login is broken".
  $backend = Join-Path $here 'app\backend'
  $app = Get-ScheduledTask -TaskName $AppTask -ErrorAction SilentlyContinue
  if ($app) {
    $entry = ($app.Actions[0].Arguments -replace '"', '').Trim()
    if ($entry -and (Test-Path $entry)) { $backend = Split-Path -Parent (Split-Path -Parent $entry) }
  }
  $envFile = Join-Path $backend '.env'
  if (Test-Path $envFile) {
    $out = @()
    $seen = $false
    foreach ($line in Get-Content $envFile) {
      if ($line -match '^SECURE_COOKIES=') { $out += 'SECURE_COOKIES=true'; $seen = $true }
      elseif ($line -match '^PUBLIC_URL=') { $out += ("PUBLIC_URL=https://{0}" -f $Hostname) }
      else { $out += $line }
    }
    if (-not $seen) { $out += 'SECURE_COOKIES=true' }
    [System.IO.File]::WriteAllLines($envFile, $out, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host 'Set SECURE_COOKIES=true in .env.'
    Stop-ScheduledTask -TaskName $AppTask -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName $AppTask -ErrorAction SilentlyContinue
    Write-Host 'Restarted the HRMS.'
  }

  # ---- did it come up ----
  Write-Host ''
  Write-Host ("Trying https://{0} ..." -f $Hostname)
  $live = $false
  for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Seconds 6
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri ("https://{0}/healthz" -f $Hostname) -TimeoutSec 8
      if ($r.StatusCode -eq 200) { $live = $true; break }
    } catch { }
    Write-Host '  not yet...'
  }

  Write-Host ''
  if ($live) {
    Write-Host ("  IT IS LIVE:  https://{0}" -f $Hostname)
  } else {
    Write-Host ("  {0} is not answering yet." -f $Hostname)
    Write-Host '  Check in the dashboard that the tunnel shows a connector, and that'
    Write-Host '  the Public Hostname is bnfhrms / scalevisory.in / HTTP / localhost:3002.'
    Write-Host ("  Task state: {0}" -f (Get-ScheduledTask -TaskName $TaskName).State)
  }
  Write-Host ''
  Write-Host '  The other three tunnels were not touched. Worth opening'
  Write-Host '  senacantonfair.com and erp.arrohanliving.in once to see them fine.'
  Write-Host ''
  Write-Host '  LAST STEP, once your own login works at the new address: delete the'
  Write-Host '  APP_PASSWORD= line from .env and run START.ps1. Until then that shared'
  Write-Host '  password is full admin for anybody who has it, from anywhere.'

} catch {
  Write-Host ''
  Write-Host '  ---- IT STOPPED ----' -ForegroundColor Red
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ''
  Write-Host '  Nothing belonging to the other tunnels was changed.'
  Write-Host '  Send a photo of this window.'
} finally {
  Write-Host ''
  Read-Host 'Press Enter to close'
}
