# Start the HRMS. Right-click -> Run with PowerShell.
Start-ScheduledTask -TaskName 'BNFHRMS'
Start-Sleep -Seconds 3
Get-ScheduledTaskInfo -TaskName 'BNFHRMS' | Format-List TaskName, LastRunTime, LastTaskResult
