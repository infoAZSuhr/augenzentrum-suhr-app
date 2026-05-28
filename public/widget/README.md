# Sekretariat-Chat – Einbettung auf augenzentrum-suhr.ch

## Hosting

Das Widget wird **nicht** über Firebase Hosting ausgeliefert, sondern
über GitHub Pages unter:

- Widget (Iframe-Inhalt): https://infoazsuhr.github.io/sekretariat-chat/
- Embed-Skript:           https://infoazsuhr.github.io/sekretariat-chat/embed.js

Diese Dateien im Verzeichnis `public/widget/` sind die **Quellen**.
Beim Deploy ins GitHub-Repo `infoazsuhr/sekretariat-chat`:

1. Repo klonen
2. Inhalte kopieren:
   - `public/widget/sekretariat-chat.html` → `index.html` (im Repo-Root)
   - `public/widget/embed.js`              → `embed.js`
3. Auf `main` pushen — GitHub Pages liefert das ab `infoazsuhr.github.io/sekretariat-chat/`.
4. In den Repo-Settings → Pages: Source = `main` Branch, Folder = `/ (root)`.

> Hinweis: das Widget greift direkt per Firebase-Web-SDK auf das
> Firestore-Projekt `azsdb-999d6` zu — kein eigener Server nötig.
> Die hardcodeten Firebase-Keys sind Public Web Keys (kein Geheimnis),
> Schutz erfolgt über Firestore-Rules.

## Einbettung in WordPress (augenzentrum-suhr.ch)

Plugin „WPCode" oder „Insert Headers and Footers" verwenden.
Im Footer-Bereich (gilt für alle Seiten) folgendes einfügen:

```html
<script src="https://infoazsuhr.github.io/sekretariat-chat/embed.js" defer></script>
```

Das Skript erzeugt unten rechts einen runden Chat-Button.
Beim Klick öffnet sich das Iframe-Popup (mobil: Vollbild).

## Einmalige Firebase-Einstellungen

Vor dem ersten produktiven Einsatz im Firebase-Console:

1. **Anonyme Authentifizierung aktivieren**
   Authentication → Sign-in method → „Anonym" aktivieren.

2. **Autorisierte Domain hinzufügen** (kritisch!)
   Authentication → Settings → Authorized domains → hinzufügen:
   - `infoazsuhr.github.io`

   Ohne diesen Eintrag schlägt `signInAnonymously()` aus dem Iframe fehl.

3. **Firestore-Rules deployen**
   ```
   firebase deploy --only firestore:rules --project azsdb-999d6
   ```

## Öffnungszeiten

Hardcoded im Widget: **Mo–Fr 09:00–17:00** (Europe/Zurich).
Ausserhalb wird der Chat geschlossen mit Hinweis auf Telefon + Notfallnummer.

Zum Ändern: `index.html` im GitHub-Repo, Funktion `isOpenNow()`.

## Datenschutz

- Besucher müssen vor dem ersten Schreiben die Hinweise bestätigen
  („keine Gesundheitsdaten, keine medizinischen Auskünfte").
- Konversations-ID = anonyme Firebase-UID, im Browser des Besuchers
  via Session gespeichert. Nach Cookie-Löschung beginnt ein neuer Chat.
- Andere Besucher sehen weder die Liste noch Inhalte fremder Chats
  (Firestore-Rules erzwingen `visitorUid == request.auth.uid`).
