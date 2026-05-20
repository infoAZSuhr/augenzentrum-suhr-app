# Zur Rose Nota-Liste – Automatisches tägliches Update
# Wird vom Windows Task Scheduler aufgerufen
# Lädt die aktuelle Nota-Liste herunter, matched Firestore-Artikel und deployed falls Änderungen.

$ProjectDir = Split-Path -Parent $PSScriptRoot
$LogFile    = Join-Path $PSScriptRoot "auto-update-zurrose.log"
$NodeExe    = "C:\Program Files\nodejs\node.exe"

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# Log auf 5000 Zeilen begrenzen (älteste Einträge entfernen)
if (Test-Path $LogFile) {
    $lines = Get-Content $LogFile
    if ($lines.Count -gt 5000) {
        $lines | Select-Object -Last 4000 | Set-Content $LogFile -Encoding UTF8
    }
}

Log "=== Zur Rose Nota-Liste Update gestartet ==="

# update-zurrose.js ausführen
$updateScript = Join-Path $PSScriptRoot "update-zurrose.js"
$result = & $NodeExe $updateScript 2>&1
$result | ForEach-Object { Log $_ }

if ($LASTEXITCODE -ne 0) {
    Log "FEHLER: update-zurrose.js fehlgeschlagen (Exit $LASTEXITCODE)"
    exit 1
}

# Prüfen ob Meta-Datei in den letzten 5 Minuten aktualisiert wurde (= neue Daten)
$metaFile = Join-Path $ProjectDir "public\zurrose-nota-meta.json"
if (-not (Test-Path $metaFile)) {
    Log "Keine Meta-Datei gefunden – kein Deploy."
    exit 0
}

$metaAge = (Get-Date) - (Get-Item $metaFile).LastWriteTime
if ($metaAge.TotalMinutes -gt 5) {
    Log "Keine Änderung erkannt – kein Deploy nötig."
    exit 0
}

Log "Neue Nota-Daten erkannt – Build + Deploy wird gestartet..."

# npm run build (über vite direkt)
Set-Location $ProjectDir
$build = & $NodeExe "node_modules\vite\bin\vite.js" build 2>&1
$build | ForEach-Object { Log $_ }

if ($LASTEXITCODE -ne 0) {
    Log "FEHLER: Build fehlgeschlagen"
    exit 1
}

# firebase deploy
$firebaseCli = (Get-Command firebase -ErrorAction SilentlyContinue)?.Source
if (-not $firebaseCli) { $firebaseCli = "$env:APPDATA\npm\firebase.cmd" }

$deploy = & $firebaseCli deploy --only hosting --project azsdb-999d6 2>&1
$deploy | ForEach-Object { Log $_ }

if ($LASTEXITCODE -ne 0) {
    Log "FEHLER: Deploy fehlgeschlagen"
    exit 1
}

Log "=== Update erfolgreich abgeschlossen ==="
