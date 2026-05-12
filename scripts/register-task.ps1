# BAG-SL-Update Task registrieren
# Ausfuehren: powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1

$ScriptPath = Join-Path $PSScriptRoot "auto-update-sl.ps1"
$TaskName   = "BAG-SL-Update"

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-05-28T08:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByMonth>
        <DaysOfMonth><Day>28</Day></DaysOfMonth>
        <Months>
          <January/><February/><March/><April/><May/><June/>
          <July/><August/><September/><October/><November/><December/>
        </Months>
      </ScheduleByMonth>
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

$tmpXml = "$env:TEMP\bag-sl-task.xml"
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
Write-Host "  notepad `"$(Join-Path $PSScriptRoot 'auto-update-sl.log')`""
Write-Host "Task entfernen:"
Write-Host "  schtasks /Delete /TN `"$TaskName`" /F"
