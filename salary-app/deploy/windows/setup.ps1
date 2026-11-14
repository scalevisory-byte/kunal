# Builds the dashboard, installs the server's packages, and writes the
# settings file once. Safe to run again: it never overwrites backend\.env.
#
# Run install-all.ps1 instead if this is the first time - it fetches Node,
# Git and NSSM first and then calls this.
#
# PLAIN ASCII ONLY in this file. Windows PowerShell 5.1 reads a BOM-less
# UTF-8 file as ANSI, so a stray accented character arrives as mojibake and
# can break parsing.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # ...\salary-app
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

Write-Host "App folder: $root"

# ---------------------------------------------------------------- Node 22
#
# better-sqlite3 11.x ships a ready-made binary for Node 22. On anything
# else npm falls through to node-gyp, which wants Visual Studio and is not
# on this server - that is exactly what happened the first time ZynTask was
# installed here, where the machine already had a newer Node.
#
# So: if the server's own Node is not 22, keep a private copy in the app
# folder and use that. The server's Node is never touched.
$wantMajor = 22
$nodeExe = $null
$have = $null
try { $have = (& node -v) 2>$null } catch { $have = $null }
if ($have -and $have -match '^v(\d+)\.') { $haveMajor = [int]$Matches[1] } else { $haveMajor = 0 }

if ($haveMajor -eq $wantMajor) {
  $nodeExe = (Get-Command node).Source
  Write-Host "Using the server's Node $have"
} else {
  $private = Join-Path $root '.node'
  $nodeExe = Join-Path $private 'node.exe'
  if (-not (Test-Path $nodeExe)) {
    $ver = 'v22.13.1'
    $zip = Join-Path $env:TEMP "node-$ver-win-x64.zip"
    Write-Host "Server Node is '$have'; fetching a private Node $ver for this app only."
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip" -OutFile $zip
    $tmp = Join-Path $env:TEMP 'node-unzip'
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if (Test-Path $private) { Remove-Item $private -Recurse -Force }
    Move-Item $inner.FullName $private
    Remove-Item $zip -Force
  }
  Write-Host "Using the private Node: $nodeExe"
}
# And PATH, not just the exe we launch.
#
# npm does NOT reuse the node it was started with for its children: it looks
# up `node` on PATH. So the private Node 22 installed the packages while
# "C:\Program Files\nodejs\node.exe" - Node 24 - was handed node-gyp to
# BUILD them. better-sqlite3 has no prebuilt binary for 24, so it fell
# through to node-gyp, which wants Python and Visual Studio and found
# neither. That is the exact failure this whole block exists to avoid, and
# choosing the right node.exe was not enough on its own.
#
# Scoped to this process, so nothing on the server's PATH changes.
$env:PATH = (Split-Path -Parent $nodeExe) + ';' + $env:PATH

$npmCli = Join-Path (Split-Path -Parent $nodeExe) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path $npmCli)) { throw "npm not found beside $nodeExe" }

function Npm([string]$where, [string[]]$npmArgs) {
  Push-Location $where
  try {
    & $nodeExe $npmCli @npmArgs
    if ($LASTEXITCODE -ne 0) { throw "npm $($npmArgs -join ' ') failed in $where" }
  } finally { Pop-Location }
}

# A half-built node_modules from an attempt that failed.
#
# better-sqlite3 is the one package here that compiles, so it is the one that
# is left unbuilt when an install dies. npm will not rebuild it on its own -
# the folder is there, so it is "installed" - and the second run fails the
# same way for a reason that has already been fixed.
foreach ($mods in @((Join-Path $backend 'node_modules'), (Join-Path $frontend 'node_modules'))) {
  $sqlite = Join-Path $mods 'better-sqlite3'
  if ((Test-Path $sqlite) -and -not (Test-Path (Join-Path $sqlite 'build'))) {
    Write-Host "A previous install left $mods half-built; clearing it."
    Remove-Item $mods -Recurse -Force
  }
}

# ------------------------------------------------------- the dashboard
Write-Host ''
Write-Host 'Building the dashboard...'
Npm $frontend @('install', '--no-audit', '--no-fund')
Npm $frontend @('run', 'build')

$public = Join-Path $backend 'public'
if (Test-Path $public) { Remove-Item $public -Recurse -Force }
New-Item -ItemType Directory -Path $public | Out-Null
Copy-Item (Join-Path $frontend 'dist\*') $public -Recurse -Force
Write-Host "Dashboard built into backend\public."

# ------------------------------------------------------- the server
Write-Host ''
Write-Host 'Installing the server packages (production only)...'
Npm $backend @('install', '--omit=dev', '--no-audit', '--no-fund')

# ------------------------------------------------------- settings
#
# Written ONCE. Running this again leaves it alone, because it holds the
# office password and the key that signs personal links - regenerating
# either would sign everybody out and void every link already sent.
$envFile = Join-Path $backend '.env'
if (Test-Path $envFile) {
  Write-Host ''
  Write-Host "backend\.env already exists - left exactly as it is."
} else {
  function NewSecret([int]$bytes) {
    $b = New-Object byte[] $bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return [Convert]::ToBase64String($b).Replace('+','').Replace('/','').Replace('=','')
  }
  $dataDir = Join-Path $root 'data'
  $lines = @(
    '# BOOKNFLY HRMS - settings for this machine.',
    '# Written once by setup.ps1. Edit by hand; it is never overwritten.',
    '',
    'PORT=3002',
    "DATA_DIR=$dataDir",
    '',
    '# A SHARED key to get you in the FIRST time. It is full admin, it has no',
    '# name on it, and the trail records what it does as "the API key" rather',
    '# than as a person. Sign in with it once, make your own admin login on',
    '# the sign-in screen, then DELETE this line and restart. The app still',
    '# starts without it once a login exists. See deploy\windows\README.md.',
    ('APP_PASSWORD=' + (NewSecret 12)),
    '',
    '# Signs the personal links (punch links, apply links). Changing it voids',
    '# every link already handed out, so leave it alone once staff have theirs.',
    ('LINK_SECRET=' + (NewSecret 24)),
    '',
    '# The address staff will open. Set this to the Cloudflare Tunnel hostname',
    '# once it is routed, so apply links point at the right place.',
    'PUBLIC_URL=https://bnfhrms.scalevisory.in',
    '',
    '# The tunnel terminates https, so the sign-in cookie may be marked Secure.',
    'SECURE_COOKIES=true',
    '',
    'TIMEZONE=Asia/Kolkata',
    '',
    '# Punching in from a phone. Off: staff sign in with a username and',
    '# password instead. Set it to true only if you want punch links as well.',
    'PUNCH_ENABLED=false'
  )
  # NO BOM. PowerShell's own -Encoding UTF8 writes one, and it glues onto the
  # first variable's name so the app reads nothing at all.
  [System.IO.File]::WriteAllLines($envFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host ''
  Write-Host "Wrote backend\.env with a fresh office password:"
  $pw = ($lines | Where-Object { $_ -like 'APP_PASSWORD=*' }) -replace '^APP_PASSWORD=', ''
  Write-Host "    $pw"
  Write-Host '    Write it down. It is the password for the whole app.'
}

Write-Host ''
Write-Host 'Setup done.'
Write-Host "Node used: $nodeExe"
