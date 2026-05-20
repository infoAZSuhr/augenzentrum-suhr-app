# Zur Rose Nota-Liste – Task Scheduler registrieren
# Einmalig ausführen (als Administrator):
#   powershell -ExecutionPolicy Bypass -File scripts\register-zurrose-task.ps1

$ScriptPath = Join-Path $PSScriptRoot "auto-update-zurrose.ps1"
$TaskName   = "ZurRose-Nota-Update"

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-05-21T07:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
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
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
  </Settings>
</Task>
"@

$tmpXml = "$env:TEMP\zurrose-nota-task.xml"
$xml | Out-File $tmpXml -Encoding Unicode
$result = schtasks /Create /TN $TaskName /XML $tmpXml /F 2>&1
Remove-Item $tmpXml -Force

Write-Host $result
Write-Host ""
Write-Host "Task '$TaskName' registriert – läuft täglich um 07:00 Uhr."
Write-Host ""
Write-Host "Nächste Ausführung:"
schtasks /Query /TN $TaskName /FO LIST | Select-String "Naechste|Nächste"
Write-Host ""
Write-Host "Jetzt manuell testen:"
Write-Host "  schtasks /Run /TN `"$TaskName`""
Write-Host ""
Write-Host "Log prüfen:"
Write-Host "  notepad `"$(Join-Path $PSScriptRoot 'auto-update-zurrose.log')`""
Write-Host ""
Write-Host "Task wieder entfernen:"
Write-Host "  schtasks /Delete /TN `"$TaskName`" /F"
