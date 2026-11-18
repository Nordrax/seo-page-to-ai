# Keeps the SEO Page to AI bridge running in the background from Windows login (no window), so the Chrome extension is
# always connected and every Claude app (Claude Code, Claude desktop) shares it. Run once in PowerShell:
#   powershell -ExecutionPolicy Bypass -File D:\seo-page-to-ai\install-hub.ps1
# Remove again:  Unregister-ScheduledTask -TaskName 'SEO Page to AI bridge' -Confirm:$false
$vbs = Join-Path $PSScriptRoot 'bridge\start-hub.vbs'
$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'SEO Page to AI bridge' -Action $a -Trigger $t -Settings $s -Description 'SEO Page to AI bridge hub (D:\seo-page-to-ai)' -Force | Out-Null
Start-ScheduledTask -TaskName 'SEO Page to AI bridge'
Start-Sleep -Seconds 3
if (Get-NetTCPConnection -LocalPort 17345 -State Listen -ErrorAction SilentlyContinue) { 'OK - bridge is running and will start at every login.' } else { 'Task created, but the bridge is not listening yet - tell Claude.' }
