# BOOKNFLY HRMS - put it on bnfhrms.scalevisory.in
#
# TSRV ALREADY RUNS A TUNNEL, and that tunnel is what serves
# tasks.scalevisory.in. Breaking it takes ZynTask off the internet. So this
# script LOOKS FIRST and shows you everything it found, backs the config up,
# and only then asks whether to add the one hostname. It never removes or
# edits a rule that is already there.
#
# Right-click -> Run with PowerShell.
#
# PLAIN ASCII ONLY - Windows PowerShell 5.1 reads a BOM-less UTF-8 file as
# ANSI, so one accented character can break the whole script.

param(
  [string]$Hostname = 'bnfhrms.scalevisory.in',
  [string]$Port = '3002',
  [string]$TaskName = 'BNFHRMS'
)

# ---- Administrator ----------------------------------------------------
$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Asking for Administrator...'
  Start-Process powershell -Verb RunAs -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
    '-Hostname', $Hostname, '-Port', $Port, '-TaskName', $TaskName
  )
  return
}

$ErrorActionPreference = 'Stop'
try {

  Write-Host ''
  Write-Host '================ WHAT IS ON THIS MACHINE ================'
  Write-Host ''

  # ---- is the app up at all ----
  $appUp = $false
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/healthz" -TimeoutSec 4
    $appUp = ($r.StatusCode -eq 200)
  } catch { }
  Write-Host ("  The HRMS on port {0}: {1}" -f $Port, $(if ($appUp) { 'answering' } else { 'NOT answering' }))
  if (-not $appUp) {
    throw "Nothing is answering on port $Port. Start it first (START.ps1), then run this again."
  }

  # ---- find cloudflared ----
  $svc = Get-Service | Where-Object { $_.Name -like '*cloudflared*' -or $_.DisplayName -like '*cloudflare*' }
  $exe = $null
  $cmdLine = ''
  if ($svc) {
    foreach ($s in $svc) {
      $wmi = Get-CimInstance Win32_Service -Filter ("Name='{0}'" -f $s.Name)
      Write-Host ("  Service '{0}' is {1}" -f $s.Name, $s.Status)
      Write-Host ("    runs: {0}" -f $wmi.PathName)
      $cmdLine = $wmi.PathName
      if ($wmi.PathName -match '"?([A-Za-z]:\\[^"]*?cloudflared[^"]*?\.exe)"?') { $exe = $Matches[1] }
    }
  } else {
    Write-Host '  No Windows service with cloudflared in its name.'
  }
  if (-not $exe) {
    $guess = Get-ChildItem -Path 'C:\', 'E:\' -Filter 'cloudflared*.exe' -Recurse -ErrorAction SilentlyContinue |
             Select-Object -First 3
    foreach ($g in $guess) { Write-Host ("  Found a cloudflared at: {0}" -f $g.FullName) }
    if ($guess) { $exe = $guess[0].FullName }
  }
  if (-not $exe) { throw 'cloudflared was not found on this machine. Is the tunnel run from somewhere else?' }

  # ---- how is it configured: a config file, or a dashboard token ----
  $configPath = $null
  if ($cmdLine -match '--config\s+"?([^"\s]+)"?') { $configPath = $Matches[1] }
  if (-not $configPath) {
    foreach ($p in @(
      "$env:USERPROFILE\.cloudflared\config.yml",
      "$env:ProgramData\Cloudflare\cloudflared\config.yml",
      'C:\cloudflared\config.yml',
      'E:\cloudflared\config.yml'
    )) { if (Test-Path $p) { $configPath = $p; break } }
  }
  $tokenRun = ($cmdLine -match '--token')

  Write-Host ''
  if ($tokenRun) {
    Write-Host '  This tunnel is run FROM THE DASHBOARD (it starts with --token).'
    Write-Host '  Its routes live in Cloudflare, not in a file here, so they cannot be'
    Write-Host '  changed from this machine. Do it in the dashboard:'
    Write-Host ''
    Write-Host '     Zero Trust -> Networks -> Tunnels -> your tunnel -> Public Hostname'
    Write-Host '     -> Add a public hostname'
    Write-Host ("        Subdomain : {0}" -f $Hostname.Split('.')[0])
    Write-Host ("        Domain    : {0}" -f ($Hostname -replace '^[^.]+\.', ''))
    Write-Host '        Type      : HTTP'
    Write-Host ("        URL       : localhost:{0}" -f $Port)
    Write-Host ''
    Write-Host '  That takes about a minute and changes nothing that is already there.'
  } elseif ($configPath) {
    Write-Host ("  Config file: {0}" -f $configPath)
    Write-Host '  ---- what is in it now ----'
    Get-Content $configPath | ForEach-Object { Write-Host ("    {0}" -f $_) }
  } else {
    Write-Host '  No config file found and no --token on the command line.'
    Write-Host '  Send a photo of this window and I will tell you the next step.'
  }

  # ---- what the settings file says ----
  $backend = Join-Path (Split-Path -Parent $PSCommandPath) 'app\backend'
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    $entry = ($task.Actions[0].Arguments -replace '"', '').Trim()
    if ($entry -and (Test-Path $entry)) { $backend = Split-Path -Parent (Split-Path -Parent $entry) }
  }
  $envFile = Join-Path $backend '.env'
  Write-Host ''
  Write-Host ("  Settings file: {0}" -f $envFile)
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
      if ($line -match '^(PUBLIC_URL|SECURE_COOKIES|PORT)=') { Write-Host ("    {0}" -f $line) }
      if ($line -match '^APP_PASSWORD=') { Write-Host '    APP_PASSWORD=(still set - the shared office password)' }
    }
  } else {
    throw "No .env at $envFile"
  }

  Write-Host ''
  Write-Host '================ WHAT WOULD CHANGE ================'
  Write-Host ''
  if ($configPath -and -not $tokenRun) {
    Write-Host ("  1. Add ONE rule to {0}:" -f (Split-Path -Leaf $configPath))
    Write-Host ("       {0}  ->  http://localhost:{1}" -f $Hostname, $Port)
    Write-Host '     Nothing already in the file is touched, and a dated backup is kept.'
    Write-Host ("  2. Point DNS at it:  cloudflared tunnel route dns <tunnel> {0}" -f $Hostname)
    Write-Host '  3. Restart the tunnel service.'
    Write-Host '  4. In .env: SECURE_COOKIES=true (the cookie is dropped over https without it).'
    Write-Host '  5. Restart the HRMS.'
  } else {
    Write-Host '  Only the .env part can be done from here:'
    Write-Host '     SECURE_COOKIES=true, once the hostname is routed in the dashboard.'
  }
  Write-Host ''
  Write-Host '  NOT done by this script: removing APP_PASSWORD. Do that only after you'
  Write-Host '  have signed in with your own admin login and checked it works.'
  Write-Host ''

  $go = Read-Host 'Type GO to make these changes, or anything else to stop'
  if ($go -ne 'GO') {
    Write-Host 'Nothing was changed.'
    return
  }

  # ---- 1 and 2: the tunnel ----
  if ($configPath -and -not $tokenRun) {
    $backup = "$configPath.before-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $configPath $backup
    Write-Host ("Backed the config up as {0}" -f (Split-Path -Leaf $backup))

    $lines = Get-Content $configPath
    if ($lines -join "`n" -match [regex]::Escape($Hostname)) {
      Write-Host "$Hostname is already in the config - leaving it alone."
    } else {
      # The rule goes BEFORE the catch-all (the service: entry with no
      # hostname), or at the end of ingress: if there is no catch-all.
      $out = New-Object System.Collections.Generic.List[string]
      $added = $false
      foreach ($line in $lines) {
        if (-not $added -and $line -match '^\s*-\s*service:\s') {
          $indent = ($line -replace '^(\s*).*$', '$1')
          $out.Add(("{0}- hostname: {1}" -f $indent, $Hostname))
          $out.Add(("{0}  service: http://localhost:{1}" -f $indent, $Port))
          $added = $true
        }
        $out.Add($line)
      }
      if (-not $added) { throw "Could not find the catch-all rule in $configPath - send me the file." }
      [System.IO.File]::WriteAllLines($configPath, $out, (New-Object System.Text.UTF8Encoding($false)))
      Write-Host 'Added the hostname to the config.'
    }

    $tunnel = ''
    foreach ($line in Get-Content $configPath) {
      if ($line -match '^\s*tunnel:\s*(\S+)') { $tunnel = $Matches[1] }
    }
    if ($tunnel) {
      Write-Host ("Pointing DNS at tunnel {0}..." -f $tunnel)
      & $exe tunnel route dns $tunnel $Hostname
      if ($LASTEXITCODE -ne 0) {
        Write-Host '  That did not work. It usually means the hostname is already routed,'
        Write-Host '  or this machine is not logged in to Cloudflare. Check the dashboard.'
      }
    }

    foreach ($s in $svc) {
      Write-Host ("Restarting {0}..." -f $s.Name)
      Restart-Service -Name $s.Name -Force
    }
    Start-Sleep -Seconds 6
  }

  # ---- 4: the cookie ----
  $envLines = Get-Content $envFile
  $out = @()
  $seen = $false
  foreach ($line in $envLines) {
    if ($line -match '^SECURE_COOKIES=') { $out += 'SECURE_COOKIES=true'; $seen = $true }
    elseif ($line -match '^PUBLIC_URL=') { $out += ("PUBLIC_URL=https://{0}" -f $Hostname) }
    else { $out += $line }
  }
  if (-not $seen) { $out += 'SECURE_COOKIES=true' }
  [System.IO.File]::WriteAllLines($envFile, $out, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host 'Set SECURE_COOKIES=true and PUBLIC_URL in .env.'

  # ---- 5: restart the app ----
  Write-Host 'Restarting the HRMS...'
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

  $ok = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 2
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/healthz" -TimeoutSec 3
      if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
  }
  Write-Host ("  Locally: {0}" -f $(if ($ok) { 'up' } else { 'NOT answering - check the logs' }))

  Write-Host ''
  Write-Host ("Trying https://{0} ..." -f $Hostname)
  $live = $false
  for ($i = 0; $i -lt 10; $i++) {
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
    Write-Host ''
    Write-Host '  Next, and do not skip it: sign in there with YOUR OWN admin login.'
    Write-Host '  Once that works, delete the APP_PASSWORD= line from .env and run'
    Write-Host '  START.ps1 again. Until you do, that shared password is full admin'
    Write-Host '  for anybody who has it, from anywhere on the internet.'
  } else {
    Write-Host ("  {0} is not answering yet." -f $Hostname)
    Write-Host '  DNS can take a few minutes. Try it in a browser shortly.'
    Write-Host '  If it still does not come up, send a photo of this window.'
  }

} catch {
  Write-Host ''
  Write-Host '  ---- IT STOPPED ----' -ForegroundColor Red
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ''
  Write-Host '  If the config was changed, the backup beside it can be put back.'
  Write-Host '  Send a photo of this window.'
} finally {
  Write-Host ''
  Read-Host 'Press Enter to close'
}
