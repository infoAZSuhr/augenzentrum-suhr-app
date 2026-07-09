# Taegliche Benutzer-Integritaets-Pruefung — wird von der Windows-
# Aufgabenplanung (Task "AZS-User-Integrity-Check", siehe
# register-user-check-task.ps1) ausgefuehrt.
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$log = Join-Path $PSScriptRoot 'auto-check-users.log'

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Check start" | Add-Content $log
node scripts/check-user-integrity.mjs *>> $log
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Check fertig (Exit $LASTEXITCODE)" | Add-Content $log
"" | Add-Content $log
