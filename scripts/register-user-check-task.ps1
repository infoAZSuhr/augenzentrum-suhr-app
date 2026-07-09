# AZS-User-Integrity-Check Task registrieren (taeglich 08:00)
# Ausfuehren: powershell -ExecutionPolicy Bypass -File scripts\register-user-check-task.ps1

$ScriptPath = Join-Path $PSScriptRoot "auto-check-users.ps1"
$TaskName   = "AZS-User-Integrity-Check"

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-07-10T08:00:00</StartBoundary>
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
    <ExecutionTimeLimit>PT15M</ExecutionTimeLimit>
  </Settings>
</Task>
"@

$tmpXml = "$env:TEMP\azs-user-check-task.xml"
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
Write-Host "  notepad `"$(Join-Path $PSScriptRoot 'auto-check-users.log')`""
Write-Host "Task entfernen:"
Write-Host "  schtasks /Delete /TN `"$TaskName`" /F"
