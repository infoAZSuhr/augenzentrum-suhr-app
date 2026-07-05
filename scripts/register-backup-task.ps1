# AZS-Firestore-Backup Task registrieren (taeglich 02:00)
# Ausfuehren: powershell -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1

$ScriptPath = Join-Path $PSScriptRoot "auto-backup.ps1"
$TaskName   = "AZS-Firestore-Backup"

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-07-05T02:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Actions>
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NonInteractive -ExecutionPolicy Bypass -File "$ScriptPath"</Arguments>
    </Exec>
  </Actions>
  <Settings>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
  </Settings>
</Task>
"@

$tmpXml = "$env:TEMP\azs-backup-task.xml"
$xml | Out-File $tmpXml -Encoding Unicode
$result = schtasks /Create /TN $TaskName /XML $tmpXml /F 2>&1
Remove-Item $tmpXml -Force

Write-Host $result
Write-Host ""
Write-Host "Naechste Ausfuehrung:"
schtasks /Query /TN $TaskName /FO LIST | Select-String "Naechste"
Write-Host ""
Write-Host "Manuell testen:"
Write-Host "  schtasks /Run /TN `"$TaskName`""
Write-Host "Log pruefen:"
Write-Host "  notepad `"$(Join-Path $PSScriptRoot 'auto-backup.log')`""
Write-Host "Task entfernen:"
Write-Host "  schtasks /Delete /TN `"$TaskName`" /F"
