# KI-Playbook — Arbeitsweise & Projektwissen (Referenz für alle Modelle)

Dieses Dokument destilliert die Arbeitsweise und das erarbeitete Projektwissen
aus den bisherigen Entwicklungs-Sessions. Es ist als Kontext für jedes Modell
gedacht (Opus, Sonnet, …), das an diesem Projekt arbeitet. Es ergänzt
`CLAUDE.md` (Projekt-Basics) um **Methodik** und **hart erarbeitete Fallstricke**.

---

## 1. Grundhaltung / Methodik

**Evidenz vor Hypothese.** Nie auf Verdacht fixen. Reihenfolge:
1. `error_log`-Collection in Firestore lesen (siehe §4) — dort landen alle
   Laufzeitfehler mit Zeit, User, Seite, Stack und bei Liris-Uploads das
   komplette Schritt-Protokoll.
2. Erst wenn die konkrete Fehlermeldung bekannt ist, den Code anfassen.
3. Wenn ein Fehler unsichtbar ist: **zuerst Sichtbarkeit bauen** (Toast +
   error_log-Eintrag), deployen, den User reproduzieren lassen, DANN fixen.
   So wurde z. B. der Liris-Upload-Bug gelöst ("Arzt nicht gefunden" →
   Kandidatenliste mitloggen → exakte Ursache sichtbar → gezielter Fix).

**Ursache statt Symptom.** Beispiele aus echten Bugs:
- "Outlook öffnet nicht" war NICHT die URL-Länge (Sekundärproblem), sondern
  `window.location.href` auf `mailto:` wird in Electron still verschluckt →
  `window.open()` nutzen (läuft über `setWindowOpenHandler` → `shell.openExternal`).
- "App hängt" war ein `beforeunload`-Handler: Electron zeigt KEINEN Dialog,
  sondern blockiert das Schließen still und dauerhaft → solche Guards nur
  im Browser registrieren (`if (electronApp) return`).

**Kleine, gezielte Diffs.** Bestehende Muster der Datei übernehmen (Kommentar-
Dichte, deutsche Kommentare mit Begründung, Naming). Kommentare erklären das
WARUM/die Einschränkung, nie das WAS.

**Selbstkritisch reviewen.** Nach jedem Feature den eigenen Diff auf
Folgefehler prüfen (Beispiel: Sofort-Markieren beim E-Mail-Versand brach den
Hintergrund-Upload, weil `reloadLiris()` die Akte schloss — solche
Wechselwirkungen aktiv suchen).

**Ehrlich berichten.** Build-Fehler, übersprungene Schritte, Einschränkungen
("Feld füllt sich erst beim Öffnen der Akten") immer explizit nennen.
Code-Verifikation ist KEIN Ersatz für einen Klicktest — als solche ausweisen.

## 2. Zusammenarbeit mit dem User (Saran Pasquale)

- **Deutsch** antworten; kurze, direkte Nachrichten; Ergebnis zuerst.
- Der User formuliert knapp und iterativ. Bei Mehrdeutigkeit: die im
  Praxis-Alltag sinnvollste Interpretation wählen, umsetzen und die
  getroffene Annahme benennen. Er korrigiert schnell ("nein, gemeint ist …").
- **Jede Änderung wird sofort deployt** (commit + push → CI deployt). Nach dem
  Deploy kurz sagen: "App/Seite neu laden zum Testen".
- Vorsichtige Automatik-Regeln explizit machen (z. B. "Zuteilungen an aktive
  Ärzte werden NIE verändert") — der User bestätigt oder verschärft sie.
- Destruktives (Release veröffentlichen, Credentials hochladen) braucht seine
  wörtliche Freigabe — der Permission-Filter verlangt das ohnehin.

## 3. Build / Deploy / Release (Stand Juli 2026)

- **Web:** Push auf `main` → GitHub Action `deploy-web.yml` (Node 24!) führt
  `npm ci` + `npm test` (vitest, 270+ Tests) + `npm run build` aus und deployt
  auf Firebase Hosting (Secret `FIREBASE_TOKEN`). **Nicht mehr lokal deployen.**
- **WICHTIG bei Bash-Pipes:** `npm run build | tail` verschluckt den Exit-Code
  → immer `echo "BUILD_EXIT=${PIPESTATUS[0]}"` prüfen, sonst wird ein
  kaputter Build gepusht (ist passiert; die CI hat ihn abgefangen).
- **Desktop (Electron):** Änderungen an `electron/main.cjs` erreichen die User
  NUR über ein Electron-Release: Workflow `electron-release.yml` per
  workflow_dispatch triggern (bump=patch). `releaseType: "release"` in
  package.json sorgt für direkte Veröffentlichung (kein Draft). Die Web-Assets
  lädt die Desktop-App dagegen live von Hosting — dafür genügt der Web-Deploy.
- **CI beobachten:** GitHub-API mit `GH_TOKEN` (persistente User-Env-Var)
  pollen; Runs des jeweiligen Workflows abfragen.

## 4. Datenzugriff & Diagnose (Admin)

- **Credentials ohne Service-Account:** Der Firebase-CLI-Login des Rechners
  wird als ADC-Datei `~/.config/azs-backup-adc.json` (authorized_user)
  wiederverwendet — `GOOGLE_APPLICATION_CREDENTIALS` darauf setzen, dann
  funktioniert `firebase-admin` (siehe `scripts/backup-firestore.mjs`).
- **error_log lesen / Migrationen:** Wegwerf-Skripte als
  `scripts/_tmp-*.mjs` INS Projekt legen (Modulauflösung!), mit `node`
  ausführen, danach löschen. Batch-Writes in 400er-Schritten.
- **Vor Massen-Migrationen:** Dry-Run mit Zählung ausgeben, bei
  Bedeutungsverlust (Freitext → Kategorie) den User entscheiden lassen.
- **Backup:** täglich 02:00 via Windows-Task "AZS-Firestore-Backup"
  (`scripts/backup-firestore.mjs`, Rotation 30). Notfall-Restore-Quelle.

## 5. Firestore-Eigenheiten

- `undefined` in Array-Elementen lässt Writes STILL scheitern → alle
  Recall/Zuweisungs-Writes laufen durch `stripUndefined()`
  (`src/lib/firestoreSanitize.ts`). Bei neuen Write-Pfaden ebenfalls nutzen.
- Änderungen an `zuweisungen` immer über die ganze Liste
  (`saveZuweisungen`/`patchZuweisung` mit Log-Eintrag "wer/was/wann").
- `recall_activity_log` ist ein **immutables Audit** — nie ändern/löschen;
  Verlauf (`verlauf` am Patienten) darf dagegen pro Zyklus geleert werden.
- Composite-Queries (where + orderBy) brauchen Indexe — für Ad-hoc-Auswertungen
  lieber clientseitig filtern.

## 6. Liris-Integration (Electron `<webview>`) — die Minenfelder

- **DOM-Scraping ist heuristisch.** Regexe eng verankern (Label davor,
  Format exakt); breite Fallbacks (ganze Seite nach Datum scannen) haben
  wiederholt falsche Treffer produziert und wurden entfernt.
  Arzt-Matching: Termin-/Datumszeilen ausschließen (enthalten Arztnamen!),
  bei Mehrdeutigkeit kürzesten reinen Namens-Eintrag wählen.
- **`executeJavaScript` wirft SYNCHRON**, wenn das Webview nicht (mehr)
  angehängt ist — `.catch()` hilft nicht. Zentraler Wrapper beim Mount
  (`__azSafeExec`) fängt das ab; Retry-Timer überleben Navigation.
- **Fokus:** Klicks IM Webview sind für den Host unsichtbar. Der injizierte
  Gast-Listener meldet `__AZ_MDOWN__` per console-message; die Fokus-Wache
  holt den Fokus nur zurück, wenn KEIN Gast-Klick vorlag (Klau) — niemals
  pauschal blurren, sonst ist Liris unbedienbar.
- **Auto-Import (Dokument ins Liris):** braucht die OFFENE Patientenakte.
  Nichts darf zwischen Brief-Erzeugung und Upload das Webview neu laden
  (`reloadLiris()` unterdrücken, solange autoUpload-Briefe anstehen).
- **Timing:** Liris rendert asynchron — Klicks auf frisch erschienene Links
  brauchen Settle-Pausen + Retry-Schleifen (Muster in `main.cjs` Auto-Import).
- Suchfeld-Cache: PID erst leeren, `input`-Event dispatchen, dann neu tippen —
  sonst liefert das Dropdown veraltete Termine. Escape/Blur NICHT senden
  (löscht die Patienten-Auswahl).

## 7. Electron vs. Web

- Feature-Gate: `isElectron` / `window.electronApp`. Electron-only-Aktionen
  (Liris öffnen/auslesen/hochladen, Outlook mit Anhang, Termin-Flow,
  Arzt-Abgleich) in der Web-Version AUSBLENDEN, nicht ausgrauen.
- `beforeunload`-Warnungen: nur Browser (s. §1).
- mailto: `window.open()`, Länge < ~1950 Zeichen (Windows verwirft längere
  still; Box-Drawing-Zeichen kosten 9 encodierte Zeichen pro Stück).

## 8. UI-Konventionen der App

- Tailwind-Pills/Chips, kleine `text-xs`-Steuerelemente, deutsche Labels.
- Dropdown-Listen (Filter etc.) nur mit real vorkommenden Werten füllen,
  aktiven Fremdwert aber wählbar lassen.
- Filterleiste schlank halten: Kontext-Filter (z. B. Grund) nur einblenden,
  wenn der übergeordnete Filter aktiv ist; Werkzeuge (Batch-Scans) gehören
  in die Auswertung, nicht in die Filterleiste.
- Bei Status-Änderungen abhängige Felder konsistent mitführen
  (Verstorben → storniert=ja + Grund=Verstorben; neuer Zyklus → Aufgebot,
  Verlauf, RC-Felder zurücksetzen).
- `window.confirm` für leichte Bestätigungen ist hier akzeptiertes Muster.

## 9. Typische Fehlerquellen (Checkliste vor dem Push)

1. Exit-Code der Pipe geprüft? (`PIPESTATUS`)
2. Neuer Firestore-Write → `stripUndefined`? Kein `undefined` in Arrays?
3. Neuer Effekt in RecallPage → Deps-Zeile ergänzt? TDZ beachtet
   (State/Refs VOR dem nutzenden Effekt deklarieren)?
4. TypeScript-Narrowing: `editTarget` ist nach dem Early-Return bereits
   `RecallPatient` — redundante Vergleiche erzeugen TS2367.
5. Electron-only? → Gate + ggf. Electron-Release nötig?
6. Läuft ein Hintergrund-Prozess (Scan/Upload), den ein Modal/Reload
   unterbrechen könnte?
7. Fehlerpfade sichtbar? (Toast + error_log statt stilles `catch`)
8. Nach Deploy: "App neu laden" kommunizieren; bei main.cjs: Release nötig.

## 10. Wo was liegt (Schnellreferenz)

| Thema | Ort |
|---|---|
| Recall-Seite (Monolith, ~8500 Z.) | `src/pages/RecallPage.tsx` |
| Reine Helper + Tests | `src/lib/recallUtils.ts` (+`.test.ts`) |
| Firestore Recall/Zuweisung | `src/lib/firestoreRecall.ts` |
| Sanitizer | `src/lib/firestoreSanitize.ts` |
| Liris-Webview + Extraktion | `src/components/layout/BrowserPanel.tsx` |
| Extract-Typen/Context | `src/contexts/BrowserContext.tsx` |
| Postausgang (Druck/Upload) | `src/components/layout/PostausgangPanel.tsx` + Context |
| Globale Fehlererfassung | `src/components/GlobalErrorHandler.tsx` → `error_log` |
| Electron-IPC / Auto-Import | `electron/main.cjs` |
| ZW-Management | `src/pages/ZuweisungPage.tsx` |
| Dashboard (live via onSnapshot) | `src/pages/Dashboard.tsx` |
| Backup & Task-Registrierung | `scripts/backup-firestore.mjs`, `scripts/register-backup-task.ps1` |
| CI/CD | `.github/workflows/deploy-web.yml`, `electron-release.yml` |
