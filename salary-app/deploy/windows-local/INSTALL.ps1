# BOOKNFLY HRMS - install from this folder. Nothing is downloaded.
#
# Everything the app needs is already here: node.exe, the packages, the
# built dashboard. No GitHub, no npm, no internet.
#
# Right-click this file -> Run with PowerShell. It asks for Administrator
# itself. Running it again is safe and is how you reinstall the service.
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

$here    = $PSScriptRoot
$node    = Join-Path $here 'node\node.exe'
$backend = Join-Path $here 'app\backend'
$entry   = Join-Path $backend 'src\index.js'
$data    = Join-Path $here 'data'
$logs    = Join-Path $here 'logs'
$envFile = Join-Path $backend '.env'

foreach ($p in @($node, $entry)) {
  if (-not (Test-Path $p)) { throw "Missing: $p  - is the zip fully extracted?" }
}
New-Item -ItemType Directory -Force -Path $data, $logs | Out-Null

Start-Transcript -Path (Join-Path $logs 'install.log') -Append | Out-Null
try {

Write-Host ''
Write-Host '=== BOOKNFLY HRMS ==='
Write-Host "  Folder:  $here"
Write-Host "  Node:    $(& $node -v)"
Write-Host ''

# ---- settings ---------------------------------------------------------
#
# Written ONCE. It holds the office password and the key that signs personal
# links; rewriting either signs everybody out and voids every link already
# handed out.
function NewSecret([int]$n) {
  $chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray()
  -join (1..$n | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
}

if (Test-Path $envFile) {
  Write-Host 'Settings already exist - leaving them alone.'
} else {
  $password = NewSecret 12
  $lines = @(
    '# BOOKNFLY HRMS settings. Restart the task after changing anything here.',
    '',
    "PORT=$Port",
    "DATA_DIR=$data",
    '',
    '# The office password. It is full admin with NO NAME on it, so the trail',
    '# records whatever it does as "the API key" rather than as a person.',
    '# Make your own login, then DELETE this line and restart.',
    ("APP_PASSWORD=" + $password),
    '',
    '# Signs the personal links (punch links, apply links). Changing it voids',
    '# every link already handed out, so leave it alone once staff have theirs.',
    ("LINK_SECRET=" + (NewSecret 24)),
    '',
    '# The address staff will open, once the tunnel is routed. Apply links and',
    '# punch links are built from it, so a wrong one sends people nowhere.',
    'PUBLIC_URL=https://bnfhrms.scalevisory.in',
    '',
    '# The tunnel terminates https, so the sign-in cookie is marked Secure.',
    '# On plain http a Secure cookie is silently dropped, which reads to',
    '# everybody as "the login is broken" - so this is false until the',
    '# tunnel is live.',
    'SECURE_COOKIES=false',
    '',
    'TIMEZONE=Asia/Kolkata'
  )
  # PowerShell's own -Encoding UTF8 writes a BOM, which glues onto the first
  # variable's NAME - so the app reads no PORT, no password, nothing.
  [IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding($false)))
  Write-Host 'Settings written.'
  Write-Host ''
  Write-Host "   OFFICE PASSWORD:  $password"
  Write-Host '   Write this down. It is also in app\backend\.env'
  Write-Host ''
}

# ---- the service ------------------------------------------------------
#
# A scheduled task, not NSSM: Task Scheduler is part of Windows, so there is
# nothing to download and nothing extra on the machine. It starts at boot,
# runs whether anybody is logged in or not, and is restarted if it stops.
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Stopping the old task..."
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$entry`"" -WorkingDirectory $backend
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host 'Starting...'
Start-Sleep -Seconds 6

# ---- did it actually come up -----------------------------------------
$ok = $false
for ($i = 0; $i -lt 10; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/healthz" -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}

Write-Host ''
Write-Host '================================================'
if ($ok) {
  Write-Host " It is up:  http://localhost:$Port"
} else {
  Write-Host " It did not answer on port $Port yet."
  Write-Host " Check:  Get-ScheduledTaskInfo -TaskName $TaskName"
  Write-Host " and the log in: $logs"
}
Write-Host "   Data (BACK THIS UP): $data"
Write-Host "   Settings:            $envFile"
Write-Host '================================================'

} finally { Stop-Transcript | Out-Null }
