# Stop the HRMS. Right-click -> Run with PowerShell.
Stop-ScheduledTask -TaskName 'BNFHRMS'
Write-Host 'Stopped.'
