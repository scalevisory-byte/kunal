# WA Tasks - put everything on a fresh Windows server in one go.
#
# Download this one file, then right-click it -> "Run with PowerShell".
# If Windows first asks "Execution Policy Change ... [Y] Yes", type Y and Enter
# (that question is Windows' own, for this one window only).
# It asks for Administrator itself, then:
#   1. installs Node.js 22, Git, Google Chrome, NSSM and cloudflared
#      (each one skipped if it is already there),
#   2. downloads WA Tasks from GitHub into C:\wa-tasks (or updates it),
#   3. builds it and asks for the settings (setup.ps1),
#   4. installs it as a Windows service that starts with the server,
#   5. optionally connects it to tasks.scalevisory.in (Cloudflare tunnel).
#
# Safe to run again: anything already installed or already set is left alone.
# Everything it prints is also saved to C:\wa-tasks-install.log - if a red
# error appears, send a photo of the screen or that file.

param([string]$Dir = 'C:\wa-tasks')

$ErrorActionPreference = 'Stop'

# --- Run as Administrator (installing software and services needs it). ---
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Dir', "`"$Dir`"")
  exit
}
Set-ExecutionPolicy -Scope Process Bypass -Force

$Repo = 'https://github.com/scalevisory-byte/kunal.git'
$Branch = 'claude/new-session-5plccw'
$NodeMajor = 22   # the version the app is built and tested on; newer majors may lack prebuilt packages
$log = 'C:\wa-tasks-install.log'
Start-Transcript -Path $log -Append | Out-Null

# Windows Server 2019's PowerShell still offers TLS 1.0 first; GitHub and
# nodejs.org refuse it. The progress bar makes downloads ten times slower.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$tmp = Join-Path $env:TEMP 'wa-tasks-install'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Download($url, $name) {
  $file = Join-Path $tmp $name
  Write-Host "Downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing
  return $file
}
function InstallMsi($file) {
  $p = Start-Process msiexec.exe -ArgumentList @('/i', "`"$file`"", '/qn', '/norestart') -Wait -PassThru
  # 3010 = installed, restart suggested; fine for all of these.
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { throw "Installing $file failed (msiexec exit $($p.ExitCode))" }
}

try {
  # --- 1. Node.js -----------------------------------------------------------
  Step "Node.js $NodeMajor"
  RefreshPath
  if (Have node) {
    # Left alone: setup.ps1 gives WA Tasks its own Node $NodeMajor if this one is different.
    Write-Host "Already installed: node $(node -v)"
  } else {
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
    $release = $index | Where-Object { $_.version -like "v$NodeMajor.*" } | Select-Object -First 1
    if (-not $release) { throw "Could not find Node.js $NodeMajor on nodejs.org" }
    $v = $release.version
    InstallMsi (Download "https://nodejs.org/dist/$v/node-$v-x64.msi" "node-$v-x64.msi")
    RefreshPath
    Write-Host "Installed node $(node -v)"
  }

  # --- 2. Git ---------------------------------------------------------------
  Step 'Git'
  if (Have git) {
    Write-Host "Already installed: $(git --version)"
  } else {
    try {
      $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -UseBasicParsing
      $asset = $rel.assets | Where-Object { $_.name -match '^Git-[\d.]+-64-bit\.exe$' } | Select-Object -First 1
    } catch { $asset = $null }
    if (-not $asset) { throw 'Could not find the Git installer. Install Git from https://git-scm.com/download/win (defaults) and run this again.' }
    $file = Download $asset.browser_download_url $asset.name
    $p = Start-Process $file -ArgumentList '/VERYSILENT /NORESTART /NOCANCEL /SP- /SUPPRESSMSGBOXES' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Installing Git failed (exit $($p.ExitCode))" }
    RefreshPath
    Write-Host "Installed $(git --version)"
  }

  # --- 3. Google Chrome (the browser WhatsApp Web runs in) ------------------
  Step 'Google Chrome'
  $chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($chrome) {
    Write-Host "Already installed: $chrome"
  } else {
    InstallMsi (Download 'https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi' 'chrome.msi')
    Write-Host 'Installed Google Chrome'
  }

  # --- 4. The app itself ----------------------------------------------------
  Step "WA Tasks into $Dir"
  if (Test-Path (Join-Path $Dir '.git')) {
    Push-Location $Dir
    git pull
    if ($LASTEXITCODE -ne 0) { throw 'git pull failed' }
    Pop-Location
  } else {
    Write-Host 'If a GitHub sign-in window opens, sign in with the scalevisory-byte account.' -ForegroundColor Yellow
    git clone -b $Branch $Repo $Dir
    if ($LASTEXITCODE -ne 0) { throw 'Downloading the app from GitHub failed (git clone)' }
  }
  $kit = Join-Path $Dir 'wa-task-assistant\deploy\windows'

  # --- 5. NSSM (keeps the app running as a service) -------------------------
  Step 'NSSM'
  $nssm = Join-Path $kit 'nssm.exe'
  if (Test-Path $nssm) {
    Write-Host "Already there: $nssm"
  } else {
    # The 2.24-101 build first: plain 2.24 has a known start-up problem on
    # Windows 10 / Server 2016 and later.
    $got = $false
    foreach ($url in @('https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip', 'https://nssm.cc/release/nssm-2.24.zip')) {
      try {
        $zip = Download $url 'nssm.zip'
        $out = Join-Path $tmp 'nssm'
        if (Test-Path $out) { Remove-Item $out -Recurse -Force }
        Expand-Archive $zip $out -Force
        $exe = Get-ChildItem $out -Recurse -Filter nssm.exe | Where-Object { $_.DirectoryName -like '*win64' } | Select-Object -First 1
        if ($exe) { Copy-Item $exe.FullName $nssm; $got = $true; break }
      } catch { Write-Host "  could not get $url ($($_.Exception.Message))" -ForegroundColor Yellow }
    }
    if (-not $got) {
      throw "nssm.cc did not answer. Download https://nssm.cc/download in a browser, put win64\nssm.exe at $nssm and run this again."
    }
    Write-Host "Saved $nssm"
  }

  # --- 6. Build and settings (asks for the password and keys) ---------------
  # If the service is already running (a second run), stop it first: Windows
  # locks a running app's files and reinstalling packages under it fails.
  if (Get-Service -Name WATasks -ErrorAction SilentlyContinue) { & $nssm stop WATasks | Out-Null }
  & (Join-Path $kit 'setup.ps1')

  # --- 7. Windows service ---------------------------------------------------
  Step 'Installing the WA Tasks service'
  & (Join-Path $kit 'install-service.ps1')

  # --- 8. Cloudflare tunnel (optional, can be done later) -------------------
  Step 'Cloudflare tunnel (tasks.scalevisory.in)'
  if (Get-Service -Name Cloudflared -ErrorAction SilentlyContinue) {
    Write-Host 'Already installed - the tunnel service is there.'
  } else {
    Write-Host 'Paste the tunnel token from Cloudflare Zero Trust -> Networks -> Tunnels'
    Write-Host '(the long text after "service install" in the Windows command it shows).'
    $token = Read-Host 'Tunnel token (leave blank to do this later)'
    $token = $token.Trim()
    if ($token -match '\s') { $token = ($token -split '\s+')[-1] }   # whole command pasted: take the token
    if ($token) {
      $cf = @(
        "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
        "$env:ProgramFiles\cloudflared\cloudflared.exe"
      ) | Where-Object { Test-Path $_ } | Select-Object -First 1
      if (-not $cf) {
        InstallMsi (Download 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi' 'cloudflared.msi')
        $cf = @(
          "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
          "$env:ProgramFiles\cloudflared\cloudflared.exe"
        ) | Where-Object { Test-Path $_ } | Select-Object -First 1
      }
      if (-not $cf) { throw 'cloudflared did not install' }
      & $cf service install $token
      if ($LASTEXITCODE -ne 0) { throw 'cloudflared service install failed - check the token' }
      Write-Host 'Tunnel installed. In Cloudflare, give it the public hostname tasks.scalevisory.in -> http://localhost:3001' -ForegroundColor Green
    } else {
      Write-Host 'Skipped. Run this file again later to add it; everything else will be left as it is.'
    }
  }

  Step 'All done'
  Write-Host 'WA Tasks is running and will start by itself with Windows.' -ForegroundColor Green
  Write-Host 'Opening http://localhost:3001 - go to Settings and scan the WhatsApp QR from your phone.'
  Start-Process 'http://localhost:3001'
} catch {
  Write-Host ''
  Write-Host "STOPPED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Send a photo of this screen, or the file $log"
} finally {
  Stop-Transcript | Out-Null
  Write-Host ''
  Read-Host 'Press Enter to close'
}
