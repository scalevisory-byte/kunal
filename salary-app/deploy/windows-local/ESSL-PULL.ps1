# ESSL-PULL.ps1 - read eTimeTrackLite's attendance and write it as JSON.
#
# The devices have "Auto Clear After Download" ticked, so they are wiped after
# every pull and eTimeTrackLite's own database is the only durable copy of a
# punch. That database is MS Access. This script opens it READ-ONLY, takes the
# AttendanceLogs rows for a date range, and writes one small JSON file that the
# HRMS imports exactly like the .xls export - same dry run, same rules, same
# screen.
#
# It writes ONE file, the one named by -Out, and nothing else. It starts no
# service, changes no setting and does not touch the database.
#
# READ-ONLY IS NOT POLITENESS. eTimeTrackLite is live on the same file. Opening
# it for writing can lock it, and a locked database is one that stops
# collecting punches - which, with Auto Clear ticked, loses them for good.
#
# Jet's Access provider is 32-bit only, so this re-launches itself under the
# 32-bit PowerShell when it finds it is running in the 64-bit one.
#
#   .\ESSL-PULL.ps1 -Db "E:\Essl\eTimeTrackLite1.mdb" -Out "E:\BNFHR\essl.json" -Days 40
#   .\ESSL-PULL.ps1 -Db "..." -Out "..." -From 2026-11-01 -To 2026-11-30

param(
  [Parameter(Mandatory = $true)][string]$Db,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Days = 40,
  [string]$From = '',
  [string]$To = ''
)

$ErrorActionPreference = 'Stop'

function Line($t) { Write-Host $t }
function Good($t) { Write-Host "   $t" -ForegroundColor Green }
function Warn($t) { Write-Host "   $t" -ForegroundColor Yellow }

# ---------------------------------------------------------------- 32-bit
if ([Environment]::Is64BitProcess) {
  $ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path $ps32)) {
    throw "Access needs 32-bit PowerShell and it is not at $ps32"
  }
  Line 'Access is 32-bit only - starting again in the 32-bit PowerShell.'
  $argv = @('-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath,
            '-Db', $Db, '-Out', $Out, '-Days', "$Days")
  if ($From) { $argv += @('-From', $From) }
  if ($To) { $argv += @('-To', $To) }
  & $ps32 @argv
  exit $LASTEXITCODE
}

if (-not (Test-Path $Db)) { throw "No database at $Db" }

$toDate = if ($To) { [datetime]::Parse($To) } else { (Get-Date).Date }
$fromDate = if ($From) { [datetime]::Parse($From) } else { $toDate.AddDays(-$Days) }
if ($fromDate -gt $toDate) { throw 'From is after To' }

Line ''
Line '================================================'
Line '  eSSL / eTimeTrackLite - read-only pull'
Line '================================================'
Good "database : $Db"
Good ("range    : {0:dd/MM/yyyy} to {1:dd/MM/yyyy}" -f $fromDate, $toDate)

$cn = New-Object -ComObject ADODB.Connection
$cn.Open("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$Db;Mode=Read;")

# ---------------------------------------------------------------- who
#
# The column names are FOUND, not assumed. eTimeTrackLite's own schema is not
# something to guess at from memory, and a wrong guess here puts somebody
# else's attendance on a payslip.
function Column-Like($table, $patterns) {
  $rs = $cn.Execute("SELECT TOP 1 * FROM [$table]")
  $names = @()
  for ($i = 0; $i -lt $rs.Fields.Count; $i++) { $names += $rs.Fields.Item($i).Name }
  $rs.Close()
  foreach ($p in $patterns) {
    foreach ($n in $names) { if ($n -match $p) { return $n } }
  }
  return ''
}

$idCol = Column-Like 'Employees' @('^EmployeeId$')
$codeCol = Column-Like 'Employees' @('^EmployeeCode$', 'Code$')
$nameCol = Column-Like 'Employees' @('^EmployeeName$', '^FirstName$', 'Name$')
$companyCol = Column-Like 'Employees' @('^CompanyId$')
if (-not $idCol) { throw 'Employees has no EmployeeId column - stopping rather than guessing' }
Good "employee columns : $idCol / $codeCol / $nameCol"

$companies = @{}
if ($companyCol) {
  try {
    $rs = $cn.Execute('SELECT * FROM [Companies]')
    $cIdCol = ''
    $cNameCol = ''
    for ($i = 0; $i -lt $rs.Fields.Count; $i++) {
      $n = $rs.Fields.Item($i).Name
      if (-not $cIdCol -and $n -match '^CompanyId$') { $cIdCol = $n }
      if (-not $cNameCol -and $n -match 'Name$') { $cNameCol = $n }
    }
    while (-not $rs.EOF) {
      if ($cIdCol -and $cNameCol) {
        $companies["$($rs.Fields.Item($cIdCol).Value)"] = "$($rs.Fields.Item($cNameCol).Value)"
      }
      $rs.MoveNext()
    }
    $rs.Close()
  } catch {
    Warn 'No readable Companies table - the company column will be blank.'
  }
}

$people = @{}
$rs = $cn.Execute("SELECT * FROM [Employees]")
while (-not $rs.EOF) {
  $id = "$($rs.Fields.Item($idCol).Value)"
  $company = ''
  if ($companyCol) { $company = $companies["$($rs.Fields.Item($companyCol).Value)"] }
  $people[$id] = @{
    code = if ($codeCol) { "$($rs.Fields.Item($codeCol).Value)".Trim() } else { $id }
    name = if ($nameCol) { "$($rs.Fields.Item($nameCol).Value)".Trim() } else { '' }
    company = "$company".Trim()
  }
  $rs.MoveNext()
}
$rs.Close()
Good "people on the machine : $($people.Count)"

# ---------------------------------------------------------------- the days
#
# Every identifier is bracketed. Jet treats a surprising number of ordinary
# words as reserved, and the error it gives says only "reserved word or
# punctuation", which names nothing.
$lo = '#' + $fromDate.ToString('MM/dd/yyyy') + '#'
$hi = '#' + $toDate.ToString('MM/dd/yyyy') + '#'
$sql = "SELECT [AttendanceDate],[EmployeeId],[InTime],[OutTime],[StatusCode],[Status] " +
       "FROM [AttendanceLogs] WHERE [AttendanceDate] >= $lo AND [AttendanceDate] <= $hi"

$stamp = {
  param($v)
  if ($null -eq $v -or $v -is [DBNull]) { return '' }
  if ($v -is [datetime]) { return $v.ToString('yyyy-MM-dd HH:mm:ss') }
  return "$v".Trim()
}

$rows = New-Object System.Collections.ArrayList
$rs = $cn.Execute($sql)
while (-not $rs.EOF) {
  $id = "$($rs.Fields.Item('EmployeeId').Value)"
  $who = $people[$id]
  # The machine's own verdict. StatusCode is what its reports print; Status is
  # the long spelling and is only a fallback.
  $code = & $stamp $rs.Fields.Item('StatusCode').Value
  if (-not $code) { $code = & $stamp $rs.Fields.Item('Status').Value }
  $null = $rows.Add([ordered]@{
    company = if ($who) { $who.company } else { '' }
    code    = if ($who) { $who.code } else { $id }
    name    = if ($who) { $who.name } else { '' }
    date    = & $stamp $rs.Fields.Item('AttendanceDate').Value
    status  = $code
    in      = & $stamp $rs.Fields.Item('InTime').Value
    out     = & $stamp $rs.Fields.Item('OutTime').Value
  })
  $rs.MoveNext()
}
$rs.Close()
$cn.Close()

Good "days read : $($rows.Count)"

$payload = [ordered]@{
  kind      = 'essl-attendance-logs'
  version   = 1
  source    = $Db
  machine   = $env:COMPUTERNAME
  pulled_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  from      = $fromDate.ToString('yyyy-MM-dd')
  to        = $toDate.ToString('yyyy-MM-dd')
  rows      = $rows
}

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$payload | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path $Out -Encoding UTF8

Line ''
Good "written : $Out"
Line ''
Line '   Import it in the HRMS: Reports -> the machine''s attendance, same as'
Line '   the .xls. It shows what it would do before it writes anything.'
Line ''
Line '   The database was opened read-only and nothing in it was changed.'
Line ''
