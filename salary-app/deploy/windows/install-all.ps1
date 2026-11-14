# BOOKNFLY HRMS on a Windows server, in one go.
#
# Download this file and right-click -> Run with PowerShell. It asks for
# Administrator itself. Everything it installs is skipped if the machine
# already has it, so running it a second time is safe and is how you add
# the Cloudflare tunnel later.
#
# Everything is logged to C:\bnf-hrms-install.log
#
# PLAIN ASCII ONLY - Windows PowerShell 5.1 reads a BOM-less UTF-8 file as
# ANSI, so one accented character can break the whole script.

param(
  [string]$Branch = 'claude/salary-calculation-software-ujbufn',
  [string]$RepoUrl = 'https://github.com/scalevisory-byte/kunal.git',
  [string]$InstallTo = 'C:\bnf-hrms',
  [string]$TunnelToken = ''
)

$ErrorActionPreference = 'Stop'
# Server 2019's PowerShell offers TLS 1.0 first, which GitHub and nodejs.org
# both refuse. Without this every download fails with a connection error.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---- Administrator ----------------------------------------------------
$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Asking for Administrator...'
  $argline = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Branch `"$Branch`" -RepoUrl `"$RepoUrl`" -InstallTo `"$InstallTo`""
  if ($TunnelToken) { $argline += " -TunnelToken `"$TunnelToken`"" }
  Start-Process powershell -Verb RunAs -ArgumentList $argline
  return
}

Start-Transcript -Path 'C:\bnf-hrms-install.log' -Append | Out-Null
try {

function Have([string]$name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

Write-Host '================================================'
Write-Host ' BOOKNFLY HRMS - installing'
Write-Host '================================================'

# ---- Git --------------------------------------------------------------
if (Have 'git') {
  Write-Host "Git is already here: $(& git --version)"
} else {
  Write-Host 'Installing Git...'
  $url = 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe'
  $exe = Join-Path $env:TEMP 'git-setup.exe'
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $exe
  Start-Process $exe -ArgumentList '/VERYSILENT','/NORESTART','/NOCANCEL','/SP-' -Wait
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}

# ---- Node -------------------------------------------------------------
#
# Only if the machine has none at all. setup.ps1 deals with the version:
# it keeps a private Node 22 beside the app when the server's own is
# something else, rather than changing a Node other things may rely on.
if (Have 'node') {
  Write-Host "Node is already here: $(& node -v)  (setup.ps1 will pin 22 for this app if needed)"
} else {
  Write-Host 'Installing Node 22...'
  $msi = Join-Path $env:TEMP 'node22.msi'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/v22.13.1/node-v22.13.1-x64.msi' -OutFile $msi
  Start-Process msiexec.exe -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart' -Wait
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}

# ---- the code ---------------------------------------------------------
$app = Join-Path $InstallTo 'salary-app'
if (Test-Path (Join-Path $InstallTo '.git')) {
  Write-Host "Updating the clone in $InstallTo ..."
  Push-Location $InstallTo
  try {
    & git fetch --all --prune
    if ($LASTEXITCODE -ne 0) { throw 'git fetch failed - is the network up, and can this machine reach GitHub?' }
    & git checkout $Branch
    if ($LASTEXITCODE -ne 0) { throw "git checkout $Branch failed" }
    & git reset --hard "origin/$Branch"
    if ($LASTEXITCODE -ne 0) { throw 'git reset failed' }
  } finally { Pop-Location }
} else {
  # Something is here that is not a clone. It is NOT deleted: the data
  # folder lives inside this one, and a clone that failed halfway leaves
  # exactly this state - so "run it again" would be the thing that loses
  # the payroll. An empty folder is fine to clone into; anything else stops.
  if (Test-Path $InstallTo) {
    $inside = Get-ChildItem -LiteralPath $InstallTo -Force -ErrorAction SilentlyContinue
    if ($inside) {
      $data = Join-Path $InstallTo 'salary-app\data'
      $warn = if (Test-Path $data) { " It contains $data, which is your payroll." } else { '' }
      throw "$InstallTo already exists and is not a clone.$warn Move it aside (or pass -InstallTo somewhere else) and run this again. Nothing has been changed."
    }
  }
  Write-Host "Cloning into $InstallTo ..."
  & git clone --branch $Branch --single-branch $RepoUrl $InstallTo
  if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
}
if (-not (Test-Path $app)) { throw "Expected $app in the clone - is the branch right?" }

$kit = Join-Path $app 'deploy\windows'

# ---- NSSM -------------------------------------------------------------
$nssm = Join-Path $kit 'nssm.exe'
if (Test-Path $nssm) {
  Write-Host 'NSSM is already in the kit folder.'
} else {
  Write-Host 'Fetching NSSM...'
  $zip = Join-Path $env:TEMP 'nssm.zip'
  $got = $false
  foreach ($url in @('https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip', 'https://nssm.cc/release/nssm-2.24.zip')) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
      $got = $true
      break
    } catch { Write-Host "  $url did not answer; trying the next one." }
  }
  if (-not $got) { throw 'Could not download NSSM. Put nssm.exe (64-bit) in the deploy\windows folder by hand and run this again.' }
  $tmp = Join-Path $env:TEMP 'nssm-unzip'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $found = Get-ChildItem $tmp -Recurse -Filter 'nssm.exe' | Where-Object { $_.FullName -like '*win64*' } | Select-Object -First 1
  if (-not $found) { throw 'No 64-bit nssm.exe inside the download.' }
  Copy-Item $found.FullName $nssm -Force
  Remove-Item $zip -Force
}

# ---- stop anything already running ------------------------------------
$running = Get-Service -Name 'BNFHRMS' -ErrorAction SilentlyContinue
if ($running -and $running.Status -ne 'Stopped') {
  Write-Host 'Stopping the running service so its files can be replaced...'
  Stop-Service -Name 'BNFHRMS' -Force
  Start-Sleep -Seconds 3
}

# ---- build and install ------------------------------------------------
& (Join-Path $kit 'setup.ps1')
& (Join-Path $kit 'install-service.ps1')

# ---- Cloudflare tunnel, if a token was handed in ----------------------
#
# Optional, and skipped entirely without a token. the BNF server already runs one
# tunnel for ZynTask; the usual thing is to add a second hostname to THAT
# tunnel in the Cloudflare dashboard rather than install another here.
if ($TunnelToken) {
  # The whole command can be pasted in; pull the token out of it.
  if ($TunnelToken -match '([A-Za-z0-9_\-\.]{60,})') { $TunnelToken = $Matches[1] }
  if (Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue) {
    Write-Host 'A Cloudflared service is already installed - leaving it alone.'
    Write-Host 'Add the HRMS hostname to that tunnel in the Cloudflare dashboard instead.'
  } else {
    Write-Host 'Installing cloudflared...'
    $exe = 'C:\Program Files\cloudflared\cloudflared.exe'
    New-Item -ItemType Directory -Path (Split-Path $exe) -Force | Out-Null
    Invoke-WebRequest -UseBasicParsing -OutFile $exe `
      -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    & $exe service install $TunnelToken
  }
}

$port = 3002
$envFile = Join-Path $app 'backend\.env'
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern '^PORT=(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
}

Write-Host ''
Write-Host '================================================'
Write-Host ' Done.'
Write-Host "   On this machine:  http://localhost:$port"
Write-Host "   App folder:       $app"
Write-Host "   Data (back this up): $(Join-Path $app 'data')"
Write-Host "   Logs:             $(Join-Path $app 'logs')"
Write-Host "   The office password is in: $envFile"
Write-Host ''
Write-Host ' Next: route a hostname to this port on your Cloudflare tunnel'
Write-Host "       (bnfhrms.scalevisory.in -> http://localhost:$port)"
Write-Host '================================================'

} finally {
  Stop-Transcript | Out-Null
}
