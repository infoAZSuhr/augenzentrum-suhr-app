# Naechtliches Firestore-Backup — wird von der Windows-Aufgabenplanung
# (Task "AZS-Firestore-Backup", siehe register-backup-task.ps1) ausgefuehrt.
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$log = Join-Path $PSScriptRoot 'auto-backup.log'

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Backup start" | Add-Content $log
node scripts/backup-firestore.mjs *>> $log
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Backup fertig (Exit $LASTEXITCODE)" | Add-Content $log
"" | Add-Content $log
