# ESSL-CHECK.ps1 - what would it take to read eSSL punches directly?
#
# Dinesh: "earlier we are using bizcompass / usme essl se direct punching
# utha leta tha". That is almost certainly Bizcompass reading
# eTimeTrackLite's OWN database, because the devices have "Auto Clear After
# Download" ticked - they are wiped after every pull, so the eTimeTrackLite
# database is the only durable copy of a punch.
#
# To do the same, three things have to be known, and NOT guessed:
#
#   1. Is eTimeTrackLite on the SAME machine as the HRMS, or another one?
#      The HRMS runs on the BNF server. The eSSL screenshot said
#      DESKTOP-6OKJT47. Those may well be the same machine under two names -
#      the server's own E: drive has an Essl folder on it. If they are, the
#      whole "can it reach the other PC" question disappears.
#   2. Which database engine? eTimeTrackLite can be set up on MS Access,
#      SQL Server or Oracle. Each is read a completely different way.
#   3. Where is it, and what is the punch table called?
#
# This script answers all three by LOOKING. It writes NOTHING, starts
# nothing, stops nothing and changes no setting. Run it, screenshot the
# output, send it over.
#
# A connection string holds a password, and this output gets photographed.
# Every password found below is replaced with *** before it is printed.

$ErrorActionPreference = 'Stop'

function Line($t) { Write-Host $t }
function Head($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Good($t) { Write-Host "   $t" -ForegroundColor Green }
function Warn($t) { Write-Host "   $t" -ForegroundColor Yellow }

# Never print a password, however it is spelt in the connection string.
function Hide-Secrets($text) {
  if (-not $text) { return $text }
  $out = $text
  foreach ($k in @('password', 'pwd', 'user id', 'uid')) {
    $out = [regex]::Replace($out, "(?i)($k\s*=\s*)[^;`"'>]*", '$1***')
  }
  return $out
}

try {
  Line ''
  Line '================================================'
  Line '  eSSL / eTimeTrackLite - read-only inspection'
  Line '================================================'

  # ---------------------------------------------------------------- 1. where
  Head 'Which machine is this?'
  Line "   Computer name : $env:COMPUTERNAME"
  Line "   Windows user  : $env:USERNAME"
  if ($env:COMPUTERNAME -ieq 'DESKTOP-6OKJT47') {
    Good 'This IS the machine from the eSSL screenshot.'
    Good 'So eTimeTrackLite and the HRMS are on one machine - no network hop.'
  } else {
    Warn "The eSSL screenshot showed DESKTOP-6OKJT47. This is $env:COMPUTERNAME."
    Warn 'Either eTimeTrackLite is on another PC, or that PC has been renamed.'
  }

  # Is the HRMS here too? That is what makes this the easy case.
  $task = Get-ScheduledTask -TaskName 'BNFHRMS' -ErrorAction SilentlyContinue
  if ($task) { Good 'The BNFHRMS task is on this machine as well.' }
  else { Warn 'No BNFHRMS scheduled task here - the HRMS is on a different machine.' }

  # ------------------------------------------------------------ 2. the install
  Head 'Looking for eTimeTrackLite (not guessing a path)'
  $roots = Get-PSDrive -PSProvider FileSystem |
    Where-Object { $_.Used -ne $null } | Select-Object -ExpandProperty Root
  Line "   Drives to look at: $($roots -join ' ')"

  $hits = @()
  foreach ($r in $roots) {
    foreach ($d in 1, 2, 3) {
      try {
        $hits += Get-ChildItem -LiteralPath $r -Directory -Depth $d -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -match '(?i)etimetrack|essl|smart.?office|time.?track' }
      } catch { }
    }
  }
  $hits = $hits | Sort-Object FullName -Unique
  if ($hits) {
    foreach ($h in $hits) { Good $h.FullName }
  } else {
    Warn 'Nothing found by name. It may be installed under a name I do not know.'
    Warn 'Open eTimeTrackLite, right-click its taskbar icon, Open file location.'
  }

  # Also ask Windows what is installed, which does not depend on a folder name.
  Head 'What Windows says is installed'
  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $apps = foreach ($k in $keys) {
    Get-ItemProperty $k -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -match '(?i)etimetrack|essl|time.?track|biometric' }
  }
  if ($apps) {
    foreach ($a in $apps) { Good "$($a.DisplayName)  ->  $($a.InstallLocation)" }
  } else {
    Warn 'No matching entry in the installed-programs list.'
  }

  # ------------------------------------------------------------- 3. the engine
  Head 'Which database is it on?'
  $folders = @()
  if ($hits) { $folders += $hits.FullName }
  if ($apps) { $folders += ($apps | Where-Object { $_.InstallLocation } | ForEach-Object { $_.InstallLocation }) }
  $folders = $folders | Where-Object { $_ -and (Test-Path $_) } | Sort-Object -Unique

  $found = $false
  foreach ($f in $folders) {
    # Access keeps the data in a file right there.
    $mdb = Get-ChildItem -LiteralPath $f -Include '*.mdb', '*.accdb' -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 12
    foreach ($m in $mdb) {
      $found = $true
      Good ("MS ACCESS file: {0}  ({1:N1} MB, changed {2})" -f `
        $m.FullName, ($m.Length / 1MB), $m.LastWriteTime.ToString('dd MMM yyyy HH:mm'))
    }

    # SQL Server / Oracle leave a connection string in a config or ini file.
    $cfg = Get-ChildItem -LiteralPath $f -Include '*.config', '*.ini', '*.xml' -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 40
    foreach ($c in $cfg) {
      $text = Get-Content -LiteralPath $c.FullName -Raw -ErrorAction SilentlyContinue
      if ($text -match '(?i)(data source|server\s*=|initial catalog|provider\s*=)') {
        $found = $true
        Good "Connection settings in: $($c.FullName)"
        $lines = $text -split "`r?`n" | Where-Object {
          $_ -match '(?i)(data source|server\s*=|initial catalog|database\s*=|provider\s*=)'
        } | Select-Object -First 6
        foreach ($l in $lines) { Line ("      " + (Hide-Secrets $l.Trim())) }
      }
    }
  }
  if (-not $found) { Warn 'No database file or connection string found in those folders.' }

  # A local SQL Server is the commonest eTimeTrackLite setup after Access.
  Head 'Is SQL Server running on this machine?'
  $sql = Get-Service -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '(?i)^MSSQL|SQLEXPRESS|OracleService' }
  if ($sql) {
    foreach ($s in $sql) { Good "$($s.Name)  [$($s.Status)]  $($s.DisplayName)" }
  } else {
    Warn 'No SQL Server or Oracle service here. Access is the likely answer then.'
  }

  # ------------------------------------------------------------------ 4. notes
  Head 'What happens with this'
  Line '   Send a screenshot of everything above. With the engine and the path'
  Line '   known, the HRMS can read the punch table on a schedule and mark'
  Line '   attendance by itself - no exporting a file every fortnight.'
  Line ''
  Line '   Reading it is the SAFE route. Pointing the four devices at our own'
  Line '   endpoint instead would stop eTimeTrackLite collecting punches, and'
  Line '   with Auto Clear After Download ticked that loses them for good.'
  Line ''
  Line '   Nothing was changed by this script. It only read.'
}
catch {
  Write-Host ''
  Write-Host "Stopped: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Send a photo of this and we will work out what it tripped on.'
}
finally {
  Write-Host ''
  Read-Host 'Press Enter to close'
}
