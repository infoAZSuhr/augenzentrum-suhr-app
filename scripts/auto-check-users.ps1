# Taegliche Benutzer-Integritaets-Pruefung — wird von der Windows-
# Aufgabenplanung (Task "AZS-User-Integrity-Check", siehe
# register-user-check-task.ps1) ausgefuehrt.
$ErrorActionPreference = 'Continue'
# Node schreibt UTF-8 nach stdout — Konsolen-Encoding hier explizit auf
# UTF-8 setzen, sonst wird die Ausgabe beim Einlesen ueber *>> verstuemmelt
# (jedes Zeichen erscheint mit Leerzeichen dazwischen).
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$log = Join-Path $PSScriptRoot 'auto-check-users.log'

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Check start" | Out-File $log -Append -Encoding utf8
node scripts/check-user-integrity.mjs 2>&1 | Out-File $log -Append -Encoding utf8
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Check fertig (Exit $LASTEXITCODE)" | Out-File $log -Append -Encoding utf8
"" | Out-File $log -Append -Encoding utf8
