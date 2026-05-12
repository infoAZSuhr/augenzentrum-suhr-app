# BAG Spezialitaetenliste – Automatisches Update
# Wird vom Windows Task Scheduler aufgerufen (28. jedes Monats)
# Prueft ob neue Version vorhanden, aktualisiert und deployed falls ja.

$ProjectDir = Split-Path -Parent $PSScriptRoot
$LogFile    = Join-Path $PSScriptRoot "auto-update-sl.log"
$NodeExe    = "C:\Program Files\nodejs\node.exe"

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

Log "=== BAG SL Update gestartet ==="

# update-sl.js ausfuehren (prueft ob aenderung vorhanden)
$updateScript = Join-Path $PSScriptRoot "update-sl.js"
$result = & $NodeExe $updateScript 2>&1
$result | ForEach-Object { Log $_ }

if ($LASTEXITCODE -ne 0) {
    Log "FEHLER: update-sl.js fehlgeschlagen (Exit $LASTEXITCODE)"
    exit 1
}

# update-refdata.js ausfuehren
$refdataScript = Join-Path $PSScriptRoot "update-refdata.js"
$result2 = & $NodeExe $refdataScript 2>&1
$result2 | ForEach-Object { Log $_ }

if ($LASTEXITCODE -ne 0) {
    Log "FEHLER: update-refdata.js fehlgeschlagen (Exit $LASTEXITCODE)"
    exit 1
}

# Pruefen ob neue Daten erzeugt wurden (sl-meta.json oder refdata-meta.json aenderungszeit)
$metaFile     = Join-Path $ProjectDir "public\sl-meta.json"
$metaFileRd   = Join-Path $ProjectDir "public\refdata-meta.json"
$metaAge      = (Get-Date) - (Get-Item $metaFile).LastWriteTime
$metaAgeRd    = if (Test-Path $metaFileRd) { (Get-Date) - (Get-Item $metaFileRd).LastWriteTime } else { [TimeSpan]::FromHours(99) }

if ($metaAge.TotalMinutes -gt 5 -and $metaAgeRd.TotalMinutes -gt 5) {
    Log "Keine aenderung erkannt – kein Deploy noetig."
    exit 0
}

Log "Neue SL-Daten erkannt – Build + Deploy wird gestartet..."

# npm run build
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
