# WA Tasks - set up (or rebuild) on a Windows server.
#
# Run from PowerShell, as Administrator, in the wa-task-assistant folder:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\setup.ps1
#
# Safe to run again: it rebuilds the dashboard and reinstalls packages, and it
# never overwrites an existing backend\.env or anything in the data folder.

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }

# 1. Node.js 20 or newer must already be installed (nodejs.org, LTS, x64 .msi).
Step 'Checking Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js is not installed. Install the LTS x64 .msi from https://nodejs.org and run this again.' }
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 20) { throw "Node.js $(node -v) is too old. Install the current LTS from https://nodejs.org." }
Write-Host "Node $(node -v) at $($node.Source)"

# 2. The browser whatsapp-web.js drives. Installed Google Chrome is preferred:
#    it is a fixed path every Windows account (including the service account)
#    can see, so nothing depends on a per-user download cache.
Step 'Finding Chrome'
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chrome) {
  Write-Host "Using installed Chrome: $chrome"
  $env:PUPPETEER_SKIP_DOWNLOAD = 'true'
} else {
  # No Chrome installed: let puppeteer download its own into the app folder,
  # not the user profile, so the service account can find it too.
  $env:PUPPETEER_CACHE_DIR = Join-Path $root '.puppeteer'
  Write-Host "Chrome not installed; puppeteer will download one into $env:PUPPETEER_CACHE_DIR"
}

# 3. Build the dashboard and put it where the backend serves it from.
Step 'Building the dashboard'
Push-Location $frontend
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed in frontend' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Dashboard build failed' }
Pop-Location
$public = Join-Path $backend 'public'
if (Test-Path $public) { Remove-Item $public -Recurse -Force }
Copy-Item (Join-Path $frontend 'dist') $public -Recurse

# 4. Backend packages.
Step 'Installing backend packages'
Push-Location $backend
npm ci --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed in backend' }
Pop-Location

if (-not $chrome) {
  $chrome = Get-ChildItem (Join-Path $root '.puppeteer') -Recurse -Filter chrome.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $chrome) { throw 'No Chrome found. Install Google Chrome and run this again.' }
  Write-Host "Using downloaded Chrome: $chrome"
}

# 5. Settings. Written once; an existing .env is left alone.
$envFile = Join-Path $backend '.env'
if (Test-Path $envFile) {
  Step 'backend\.env already exists - left as it is'
} else {
  Step 'Writing backend\.env (copy the values from Railway -> Variables)'
  $dataDir = Read-Host 'Data folder [C:\wa-tasks-data]'
  if (-not $dataDir) { $dataDir = 'C:\wa-tasks-data' }
  $apiKey = Read-Host 'ANTHROPIC_API_KEY (leave blank for manual mode, no AI)'
  $password = Read-Host 'DASHBOARD_PASSWORD'
  $vapidPublic = Read-Host 'VAPID_PUBLIC_KEY (blank if not set on Railway)'
  $vapidPrivate = Read-Host 'VAPID_PRIVATE_KEY (blank if not set on Railway)'
  $mode = if ($apiKey) { 'ai' } else { 'manual' }
  $lines = @(
    "EXTRACTION_MODE=$mode",
    "ANTHROPIC_API_KEY=$apiKey",
    "DASHBOARD_PASSWORD=$password",
    "PORT=3001",
    "CORS_ORIGIN=https://tasks.scalevisory.in",
    "SERVE_FRONTEND=true",
    "DATA_DIR=$dataDir",
    "TIMEZONE=Asia/Kolkata",
    "PUPPETEER_EXECUTABLE_PATH=$chrome",
    "VAPID_PUBLIC_KEY=$vapidPublic",
    "VAPID_PRIVATE_KEY=$vapidPrivate",
    "VAPID_SUBJECT=mailto:scalevisory@gmail.com"
  )
  # UTF-8 WITHOUT a byte-order mark: Windows PowerShell's own UTF8 encoding
  # writes one, and it would glue itself to the first variable's name.
  [System.IO.File]::WriteAllText($envFile, ($lines -join "`r`n") + "`r`n", (New-Object System.Text.UTF8Encoding $false))
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  Write-Host "Saved $envFile"
}

Step 'Done'
Write-Host 'Test it now:   cd backend ; node src\index.js   then open http://localhost:3001'
Write-Host 'Then run deploy\windows\install-service.ps1 so it starts by itself with Windows.'
