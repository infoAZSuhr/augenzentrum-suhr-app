/**
 * seed-onboarding.mjs
 * Erstellt die SOP-Struktur für das Onboarding-Modul im Augenzentrum Suhr.
 * Ausführen: node scripts/seed-onboarding.mjs
 */
import { initializeApp } from 'firebase/app'
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyAYRnIZJ46oEPUIZ9uRiLDbTWW0dB93vgQ",
  authDomain: "azsdb-999d6.firebaseapp.com",
  projectId: "azsdb-999d6",
  storageBucket: "azsdb-999d6.firebasestorage.app",
  messagingSenderId: "782091866487",
  appId: "1:782091866487:web:4616ff6bf7cce1e15c1172",
}

const app  = initializeApp(firebaseConfig)
const db   = getFirestore(app)
const S    = 'onboarding_sections'
const SS   = 'onboarding_subsections'
const P    = 'onboarding_pages'

async function addSection(title, color, order) {
  const ref = await addDoc(collection(db, S), { title, color, order, createdAt: serverTimestamp() })
  return ref.id
}
async function addSubsection(sectionId, title, order) {
  const ref = await addDoc(collection(db, SS), { sectionId, title, order, createdAt: serverTimestamp() })
  return ref.id
}
async function addPage(subsectionId, sectionId, title, content, order) {
  await addDoc(collection(db, P), {
    subsectionId, sectionId, title, content, order,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
const SECTIONS = [
  {
    title: 'Einführung & Allgemeines', color: 'blue', subsections: [
      {
        title: 'Erste Schritte', pages: [
          {
            title: 'Willkommen im Augenzentrum Suhr',
            content: `<h2>Herzlich Willkommen!</h2>
<p>Dieser Leitfaden begleitet Sie durch Ihren Einstieg im Augenzentrum Suhr. Er enthält alle wichtigen Abläufe, Checklisten und Hinweise für die tägliche Arbeit.</p>
<h3>Ihre ersten Tage</h3>
<ul>
  <li>Lernen Sie das Team und die Räumlichkeiten kennen.</li>
  <li>Machen Sie sich mit Liris (Praxissoftware) vertraut – Ihre Vorgesetzte zeigt Ihnen die Grundfunktionen.</li>
  <li>Schauen Sie bei Voruntersuchungen zu, bevor Sie selbst messen.</li>
  <li>Fragen kostet nichts – das ganze Team hilft gerne weiter.</li>
</ul>
<h3>Wichtige Grundsätze</h3>
<ul>
  <li>Patienten werden immer freundlich und professionell empfangen.</li>
  <li>Datenschutz hat oberste Priorität – keine Patientendaten nach aussen.</li>
  <li>Alle Messungen und Eintragungen sofort ins Liris übertragen.</li>
  <li>Unsicherheiten immer ansprechen, nie raten.</li>
</ul>`
          },
          {
            title: 'Wichtige Kontakte & Telefonnummern',
            content: `<h2>Wichtige Kontakte</h2>
<h3>Intern</h3>
<table>
  <thead><tr><th>Person / Bereich</th><th>Erreichbarkeit / Hinweis</th></tr></thead>
  <tbody>
    <tr><td>Praxis Suhr</td><td>Hauptnummer Augenzentrum Suhr</td></tr>
    <tr><td>Michael Pasquale</td><td>Geschäftsführung – michael.pasquale@augenzentrum-suhr.ch</td></tr>
    <tr><td>Tamara Braun</td><td>Buchhaltung Schönbühl – tamara.braun@augenzentrum-moossee.ch</td></tr>
  </tbody>
</table>
<h3>Externe Partner</h3>
<table>
  <thead><tr><th>Partner</th><th>Kontakt</th></tr></thead>
  <tbody>
    <tr><td>Sermax (OP-Sterilisation)</td><td>Frau Grljic: 079 197 77 16</td></tr>
    <tr><td>Ärztekasse</td><td>Rechnungsfragen über Tamara Braun</td></tr>
    <tr><td>KSA Ophthalmologie OP-Planung</td><td>OP-Anmeldungen ins Fach legen</td></tr>
  </tbody>
</table>
<p><strong>Tipp:</strong> Vollständige Telefon- und Adresslisten befinden sich auf OneDrive unter <em>Augenzentren → 1_Schönbühl → 2_SB-Dokumentation → 3 SB-Admin → Allgemeine Informationen</em>.</p>`
          },
        ]
      },
      {
        title: 'Tagesablauf', pages: [
          {
            title: 'Morgen-Checkliste – Praxisöffnung',
            content: `<h2>Morgen-Checkliste</h2>
<p>Folgende Punkte vor dem Eintreffen der ersten Patienten erledigen:</p>
<ol>
  <li>Alle Geräte starten: PCs, AR, OCT, Octopus, Endothelmikroskop</li>
  <li>Software starten und einloggen: Liris, Outlook, HIN</li>
  <li>Behandlungszimmer checken:
    <ul>
      <li>Augentropfen, Kosmetiktücher, Tonokö​pflis vorhanden?</li>
      <li>Desinfektionsmittel aufgefüllt?</li>
      <li>Tupfer, Stäbchen, Alkohol bereit?</li>
    </ul>
  </li>
  <li>Tagesagenda ausdrucken und auf Arzt-Pult legen</li>
  <li>Mikroskop aufdecken</li>
  <li>Desinfektionsbad kontrollieren (noch stabil?)</li>
  <li>Aufsätze für Augendruckmessung aus Desinfektionsbad nehmen <strong>(Einwirkzeit streng beachten!)</strong> und im Arzt-Zimmer verräumen</li>
  <li>Prüfen ob Praxismanager fehlerfrei startet</li>
  <li>IVT-Möppli bereit legen (falls IVT-Termine)</li>
  <li>OP-Vorbereitungscouverts bereit legen falls nötig</li>
</ol>`
          },
          {
            title: 'Abend-Checkliste – Praxisschluss',
            content: `<h2>Abend-Checkliste</h2>
<p>Am Ende jedes Arbeitstages:</p>
<ol>
  <li><strong>Rechnungen:</strong> Alle Tagesberichte und Rechnungen fertigstellen und abschliessen</li>
  <li><strong>Arztbriefe:</strong> Alle HA-Berichte und Korrespondenz erledigen</li>
  <li><strong>Flächendesinfektion:</strong>
    <ul>
      <li>Tische und Spaltlampe abwischen</li>
      <li>Arbeitsflächen sauber machen</li>
    </ul>
  </li>
  <li><strong>Verbrauchsmaterial auffüllen:</strong> Tupfer, Stäbchen, Alkohol, Augentropfen (Tropfen so einsetzen, dass sie beim Öffnen nicht über die Finger laufen)</li>
  <li><strong>Geräte:</strong>
    <ul>
      <li>Aufsätze für Augendruckmessung ins Desinfektionsbad legen <strong>(Einwirkzeit beachten! Aufsätze gehen bei zu langer Desinfektion kaputt)</strong></li>
      <li>Mikroskop abdecken</li>
      <li>ICare Ladezustand prüfen</li>
      <li>Amsler-Tafel vorhanden?</li>
    </ul>
  </li>
  <li>Letzte Kontrolle: Alle Türen und Fenster geschlossen, Alarm scharf schalten</li>
</ol>`
          },
        ]
      },
    ]
  },

  {
    title: 'Voruntersuchungen', color: 'green', subsections: [
      {
        title: 'Geräte & Messungen', pages: [
          {
            title: 'Autorefraktor (AR) & Visus-Bestimmung',
            content: `<h2>Autorefraktor (AR)</h2>
<ol>
  <li>Gerät desinfizieren, Kinn- und Stirnstütze positionieren</li>
  <li>Patient als Erstes fragen: <strong>Trägt er Kontaktlinsen?</strong> → Falls ja, herausnehmen und in BSS einlegen</li>
  <li>Patient soll sich mit dem betroffenen Auge auf den Heissluftballon konzentrieren, <strong>nicht sprechen</strong></li>
  <li>Augen OD / OS nacheinander mit Joystick justieren und ausmessen (automatisch oder manuell durch 2× Klick auf Joystick)</li>
  <li>Kein Feinabgleich machen – kein manueller Modus</li>
</ol>
<h2>Visus-Bestimmung</h2>
<ul>
  <li>Visus und Refraktion <strong>immer sofort ins Liris übertragen</strong></li>
  <li>Gilt für Erwachsene: OBJ/SBJ wählen</li>
  <li>Bei Kindern/Teens: kein Visus, stattdessen LT-Test</li>
  <li>Falls Patient eine Zeile nicht sieht, darf Korrektur leicht angepasst werden</li>
  <li><strong>Regel:</strong> 2 Buchstaben einer Zeile nicht gesehen → Zeile gilt als nicht gesehen</li>
</ul>
<h2>Lensmeter</h2>
<p>Bei jedem <strong>neuen Patienten</strong> die Brille mit dem Lensmeter ausmessen.</p>`
          },
          {
            title: 'Fundusfotografie',
            content: `<h2>Fundusfoto</h2>
<ol>
  <li>Patienten anweisen, <strong>gerade auf den grünen Punkt</strong> zu schauen</li>
  <li>Warnen: «Es kommt ein Blitz – Sie werden kurz geblendet»</li>
  <li>Patient soll nicht sprechen, Blinzeln vermeiden</li>
  <li>Falls unten ein Schatten im Foto sichtbar ist: <strong>Oberlid hochhalten</strong> und nochmals fotografieren</li>
  <li>Fotos müssen <strong>scharf</strong> sein – unscharfe Fotos wiederholen</li>
</ol>
<p><strong>Tipp:</strong> Bei schwierigen Patienten (starkes Blinzeln) erst nach Dilatation fotografieren – das erleichtert die Aufnahme erheblich.</p>`
          },
          {
            title: 'Dilatation (Weitstellung)',
            content: `<h2>Dilatation der Pupille</h2>
<h3>Wann immer dilatieren?</h3>
<ul>
  <li>Mouches à volantes (Glaskörpertrübungen)</li>
  <li>Lichtblitzen</li>
  <li>Diabetiker – <strong>immer dilatieren</strong></li>
</ul>
<h3>Ablauf</h3>
<ol>
  <li>Dilatation <strong>direkt nach dem Sehtest</strong> durchführen, nicht warten</li>
  <li>Mix-Tropfen oder Tropicamide applizieren</li>
  <li>2. Tropfen nach <strong>5 Minuten</strong> geben – <strong>Timer stellen!</strong></li>
  <li>Patienten mit Kontaktlinsen: Linsen entfernen, mindestens <strong>2 Stunden</strong> nicht wieder einsetzen</li>
</ol>
<h3>Biometrie-Patienten</h3>
<ul>
  <li>Zeit der Mix-Tropfen-Applikation <strong>im Liris notieren</strong></li>
  <li>Vor Biometrie fragen: Hat Patient einen <strong>refraktiven Eingriff (LASIK, PRK)</strong> an der Hornhaut gehabt?</li>
  <li>Kontaktlinsen: <strong>2 Wochen vor Biometrie nicht tragen</strong></li>
</ul>`
          },
          {
            title: 'OCT – Makula & Disc (REVO)',
            content: `<h2>OCT – Makula</h2>
<ol>
  <li>Patient schaut <strong>gerade auf das Fadenkreuz</strong> – falls er es nicht sieht, kann es vergrössert werden</li>
  <li>Patient soll <strong>nicht sprechen</strong></li>
  <li>Blinzeln erlaubt, solange das Bild noch nicht ausgelöst wird («vor Messung»)</li>
</ol>
<h2>OCT – Disc</h2>
<ol>
  <li>Patient soll das Fadenkreuz (rechts oder links je nach Auge) fixieren</li>
  <li>Augenklappe auf nicht-gemessenes Auge</li>
  <li>Patient soll <strong>nicht sprechen</strong></li>
  <li>Blinzeln erlaubt während Vorschau-Phase</li>
</ol>
<p><strong>Hinweis:</strong> OCT Makula sowie Disc ist bei schwierigen Patienten immer einfacher <strong>unter Dilatation</strong>!</p>
<h3>Speichern</h3>
<ul>
  <li>Unter Analyse alle Bilder («Beide Augen») mittels «Übergabe» auf den mittleren Ordner speichern</li>
  <li>OD-Bilder bei OD, OS-Bilder bei OS hinterlegen</li>
</ul>`
          },
          {
            title: 'Biometrie & Pachymetrie',
            content: `<h2>Biometrie & Pachymetrie (Lenstar / REVO)</h2>
<h3>Vorbereitung</h3>
<ul>
  <li>Mix-Tropfen applizieren, Timer stellen (5 Min. bis 2. Tropfen)</li>
  <li>Kontaktlinsenträger: <strong>2 Wochen keine Linsen</strong> vor der Messung</li>
  <li>LASIK/PRK-Voroperationen im Liris vermerken</li>
</ul>
<h3>Messung</h3>
<ol>
  <li>Messung mindestens <strong>2× auslösen</strong> (Christian braucht ausreichend Werte)</li>
  <li>Auf Fehlermeldung achten: «Test-Auge einlesen» → Gerät muss kalibriert werden (separate Anleitung beim Gerät)</li>
  <li>Auf Qualität achten: Möglichst viele Werte in der Tabelle sichtbar (besonders <strong>ACD und LT</strong> müssen Zahlen zeigen)</li>
  <li>Topografie: <strong>4 grüne OK</strong> müssen angezeigt sein; ggf. Oberlid mit Wattestäbchen halten</li>
</ol>
<h3>Eintrag ins Liris (bei IOL-Biometrie)</h3>
<ul>
  <li>Hornhautdicke (CCT) eintragen</li>
  <li>Geplante Linse (von Christian auf OP-Anmeldung) eintragen</li>
  <li>Notiz: <em>«Biometrie IOL für Operation»</em></li>
  <li>Allergien, Platzangst oder Besonderheiten vermerken</li>
  <li>Vermerk: wird OP geplant oder meldet sich Patient selbst?</li>
</ul>
<h3>IOL-Berechnung speichern</h3>
<p>Reiter «IOL-Berechnung» anklicken → «Manuell eingeben» mit Messwerten füllen → mittels «Übergabe» in mittleren Ordner speichern.</p>`
          },
          {
            title: 'Gesichtsfeldmessung (Octopus)',
            content: `<h2>Gesichtsfeld-Messung – Octopus</h2>
<h3>Gerät starten</h3>
<ol>
  <li>Kippschalter am Tisch einschalten (Tischhöhe verstellen)</li>
  <li>Einschaltknopf am Octopus drücken (unten links)</li>
  <li>Falls nicht funktioniert: Kippschalter beim Kabelport suchen und einschalten</li>
</ol>
<h3>Patienten erfassen</h3>
<ol>
  <li>Patientenname in Suchleiste eingeben</li>
  <li>Falls nicht vorhanden: <strong>«+»</strong> klicken und Patient erfassen</li>
</ol>
<h3>Korrektur einstellen</h3>
<ul>
  <li>Auf kleines Gerät oben links klicken → «Perimetrie»</li>
  <li>Korrektur eintragen (VIS/AR-Werte genügen)</li>
  <li>Beachten: <strong>Hornhautverkrümmung, Alter und Distanz bei GF-Messung</strong> (separater Rechner für Gläsli)</li>
  <li>OD = Rechts, OS = Links</li>
  <li>«Korrekturglas verwenden» anklicken, beide weissen Felder anklicken → Korrekturgläser einsetzen</li>
</ul>
<h3>Untersuchung durchführen</h3>
<ol>
  <li>Untersuchung wählen: Vorauswahl <strong>«G Dynamic»</strong> ist fast immer korrekt</li>
  <li>Bei gebrechlichen / ungeduldigen Patienten: «+ Neue Untersuchung» → G-Glaukom, zentral, TOP oder Pulsar</li>
  <li>Patienten mit <strong>Augenklappe</strong> versehen und positionieren</li>
  <li>Knopf in die Hand geben – prüfen, ob Patient weiss wie er drücken und loslassen soll</li>
  <li><strong>Instruktion immer durchführen</strong>, auch bei Patienten die schon gemessen wurden – insbesondere auf die Pausenfunktion hinweisen</li>
  <li>Test starten; Fixationskontrolle auf «Med.» belassen (wenn möglich)</li>
</ol>
<h3>Ergebnis speichern</h3>
<ol>
  <li>«Untersuchung anzeigen» klicken</li>
  <li>Drucker-Symbol klicken → Daten auf rechten PC übertragen</li>
  <li>Daten im Ordner «Octopus» beim Patienten hinterlegen (<strong>OD bei OD, OS bei OS</strong>)</li>
</ol>`
          },
          {
            title: 'Tonometrie – Augendruck (iCare)',
            content: `<h2>Augendruck messen – iCare</h2>
<ol>
  <li>Aufsatz aus dem Desinfektionsbad nehmen (<strong>Einwirkzeit beachten</strong>)</li>
  <li>Aufsatz ins Gerät einsetzen</li>
  <li>Patienten anweisen geradeaus zu schauen, nicht blinzeln</li>
  <li>Messung 3× durchführen für verlässlichen Mittelwert</li>
  <li>Wert sofort ins Liris übertragen (Tarmed 08.0220)</li>
  <li>Nach Messung: Aufsatz ins Desinfektionsbad zurücklegen</li>
</ol>
<p><strong>Achtung:</strong> Aufsätze gehen bei zu langer Desinfektion kaputt – Einwirkzeit genau einhalten!</p>
<p>Am Abend: ICare Ladezustand prüfen.</p>`
          },
          {
            title: 'Endothelfoto (Tomey)',
            content: `<h2>Endothelfoto – Tomey (mittleres Gerät)</h2>
<ol>
  <li>Patient im Gerät erfassen: Mensch-mit-Stift-Piktogramm oben links</li>
  <li>Falls bereits ein Patient erfasst ist: Lange auf <strong>«New»</strong> drücken</li>
  <li>Patient sieht ein oranges Licht beim Foto</li>
  <li>Foto machen – falls nicht alle Zahlen als Resultat angezeigt werden: neue Aufnahme via <strong>«Retake»</strong> (Knopf unten rechts lange gedrückt halten)</li>
  <li>Aufpassen, <strong>welche Seite</strong> angezeigt wird (OD/OS)</li>
  <li>Bei gutem Foto: unten mittig auf <strong>«Export & Save»</strong> klicken → nochmals bestätigen</li>
</ol>
<p><em>Hinweis: Das Bild wird spiegelverkehrt gespeichert – das ist normal.</em></p>`
          },
        ]
      },
    ]
  },

  {
    title: 'Liris – Praxissoftware', color: 'purple', subsections: [
      {
        title: 'Patientenverwaltung', pages: [
          {
            title: 'Neupatient anlegen',
            content: `<h2>Neupatient anlegen – Schritt für Schritt</h2>
<h3>1. Einwilligungsformular</h3>
<ol>
  <li>Einwilligungsformular ausdrucken und vom Patienten ausfüllen und unterschreiben lassen</li>
  <li>Pflichtfelder: Vor- und Nachname, Adresse, Telefonnummer, E-Mail, KK-Versicherungsnr., KK-Gesellschaft, zuweisender Arzt / Hausarzt</li>
  <li>Bei Unmündigkeit: gesetzliche Vertreter zwingend erfassen</li>
</ol>
<h3>2. Patient in Liris anlegen</h3>
<ol>
  <li>Vor- und Nachname eintragen</li>
  <li>Geburtsdatum eintragen</li>
  <li>Telefonnummer und Grund der Konsultation eintragen</li>
  <li>Kürzel des Erstellers eintragen</li>
</ol>
<h3>3. Patient vollständig erfassen</h3>
<ol>
  <li>KK-Karte durch Lesegerät ziehen oder manuell eingeben (807…)</li>
  <li>Geschlecht auswählen</li>
  <li>Adresse und Telefon auf Aktualität prüfen</li>
  <li>E-Mail-Adresse eintragen</li>
  <li>Hausarzt / zuweisenden Arzt eintragen</li>
  <li>Behandlungsgrund wählen (normalerweise: <strong>Krankheit</strong>)</li>
  <li>Art der Rückzahlung:
    <ul>
      <li><strong>Tiers Garant</strong> = Abrechnung über Patienten</li>
      <li><strong>Tiers Payant</strong> = Abrechnung über Krankenkasse</li>
    </ul>
  </li>
  <li>Bei Unmündigkeit: gesetzliche Vertreter unter «Zusätzliche Kontakt» erfassen</li>
</ol>
<h3>4. Einwilligung scannen und ablegen</h3>
<ol>
  <li>Ausgefülltes Formular einscannen</li>
  <li>Im Liris: Patient auswählen → «Dokument importieren»</li>
  <li>Verantwortlichen Arzt auswählen; Dokumenttyp: «Patient Admin»; Bemerkung: «Einwilligung»</li>
  <li>Dokument per Drag & Drop ins Feld ziehen → mit grünem Haken bestätigen</li>
  <li>Unter «Persönliche Daten» grünen Stift → nach unten scrollen → «Einwilligung erteilt» ankreuzen</li>
</ol>`
          },
          {
            title: 'Konsultation erstellen',
            content: `<h2>Konsultation in Liris erstellen</h2>
<ol>
  <li>Patient öffnen</li>
  <li>Neue Konsultation erstellen</li>
  <li>Folgende Messungen durchführen und sofort eintragen:
    <ul>
      <li>AR (Autorefraktor / Sehtest)</li>
      <li>Visus OD/OS</li>
      <li>Tensio (Augendruck) → Tarmed 08.0220</li>
      <li>Falls Dilatation: Mix-Tropfen Uhrzeit notieren</li>
      <li>OCT → Tarmed 08.1110 (wenn für Diagnose notwendig: separater Code)</li>
      <li>Gesichtsfeld → Tarmed 08.0340</li>
    </ul>
  </li>
  <li>Übertrag aus dem Praxismanager / grauer Box der letzten Konsultation: subj. Refraktion, GAT, #1 und #2 ins Liris eingeben</li>
  <li>Rechnung vorbereiten: Aktenstudium und Vorbesprechung eintragen falls zutreffend</li>
</ol>
<h3>Wichtige Tarmed-Codes</h3>
<table>
  <thead><tr><th>Code</th><th>Leistung</th></tr></thead>
  <tbody>
    <tr><td>00.0050</td><td>Untersuchung 6–75-jährige</td></tr>
    <tr><td>00.0055</td><td>Untersuchung unter 6 oder über 75 Jahre</td></tr>
    <tr><td>08.0220</td><td>Augendruck (Tonometrie)</td></tr>
    <tr><td>08.0340</td><td>Gesichtsfeld</td></tr>
    <tr><td>08.1110</td><td>Fundus oder OCT (wenn nicht diagnoseentscheidend)</td></tr>
    <tr><td>08.0040</td><td>Sehtest / Refraktionsbestimmung</td></tr>
    <tr><td>00.2285</td><td>Nicht formalisierter Arztbericht (HA-Bericht)</td></tr>
  </tbody>
</table>`
          },
          {
            title: 'Recall in Liris erstellen',
            content: `<h2>Recall in Liris erstellen</h2>
<ol>
  <li>Patient im Liris öffnen</li>
  <li>Unten links auf <strong>«To Do»</strong> klicken</li>
  <li>Im neuen Fenster auf <strong>«Recall»</strong> klicken</li>
  <li>Im Textfeld eingeben: wann und wofür der Recall ist<br>
    <em>Beispiel: «Kontrolle mit Visus/AR, Fundus Termin im August 2025»</em></li>
  <li>Auf das <strong>Häkchen</strong> neben dem Textfeld klicken</li>
</ol>
<p>✅ Der Recall ist erstellt – der Patient ist direkt markiert.</p>
<h3>Aufgebote schreiben (aus Recall-Liste)</h3>
<ol>
  <li>Im Liris den entsprechenden Arzt auswählen</li>
  <li>Tage anschauen für die Aufgebote geschrieben werden</li>
  <li>Orangefarbene Termine = Aufgebote → <strong>doppelt buchen</strong></li>
  <li>Blaue Termine = bestehende Patienten → <strong>nicht doppelt buchen</strong></li>
  <li>Patienten aus der Excel-Liste abgleichen: Hat er bereits einen Termin? Hatte er kürzlich eine Konsultation? Wünscht er kein Aufgebot?</li>
  <li>Termin zuweisen: Patient öffnen → oben rechts Brief-Icon → «Aufgebot» bestätigen und drucken</li>
  <li>In Couvert geben, frankieren, stempeln</li>
</ol>
<h3>Farbcodierung in der Excel-Liste</h3>
<table>
  <thead><tr><th>Farbe</th><th>Bedeutung</th></tr></thead>
  <tbody>
    <tr><td>🟢 Grün</td><td>Hat Termin oder Termin erhalten</td></tr>
    <tr><td>🟠 Orange</td><td>Wartet auf Termin oder möchte kein Aufgebot</td></tr>
    <tr><td>🔴 Rot</td><td>Inaktiv oder Verstorben</td></tr>
  </tbody>
</table>`
          },
          {
            title: 'HA-Bericht erstellen',
            content: `<h2>Hausarztbericht (HA-Bericht) erstellen</h2>
<h3>Aus einer abgeschlossenen Untersuchung</h3>
<ol>
  <li>Untersuchung öffnen, für welche der Bericht erstellt werden soll</li>
  <li>Brief-Symbol in der Untersuchung anklicken</li>
  <li>In den Vorlagen <strong>«HA-Bericht»</strong> auswählen</li>
  <li>Blaues Zahnrad anklicken → «Von dieser Modulgruppe entfernen» anklicken</li>
  <li>Rechnung vom Brief erstellen: Tarmed-Nr. <strong>00.2285</strong> (Nicht formalisierter Arztbericht)</li>
</ol>
<h3>Aus einer noch offenen Untersuchung</h3>
<ol>
  <li>Brief wie oben erstellen</li>
  <li><strong>Nicht vom Modul entkoppeln</strong></li>
  <li>Rechnungsposition 00.2285 bei der Rechnung hinzufügen</li>
</ol>
<p><strong>Wichtig:</strong> Auf dem HA-Bericht muss <strong>«Kopie an: Hausarzt»</strong> stehen – auch wenn der Hausarzt intern ist. Falls kein Hausarzt erfasst ist, beim Patienten nachfragen.</p>`
          },
        ]
      },
      {
        title: 'Rechnungen', pages: [
          {
            title: 'Rechnung stellen – Ablauf',
            content: `<h2>Rechnungen stellen</h2>
<h3>Ablauf</h3>
<ol>
  <li>Rechnung wird erstellt vom Arzt oder nach Absprache von der MPA</li>
  <li>Prüfen: Ist die Rechnung vollständig und korrekt?</li>
  <li>Nur Rechnungsabschnitte hinzufügen, wenn ein entsprechender Eintrag in der Konsultation vorhanden ist</li>
  <li>Liris übermittelt die Rechnung automatisch an die Ärztekasse</li>
</ol>
<h3>Wenn die Krankenkasse nicht bezahlt</h3>
<ol>
  <li>Info per Brief oder von Ärztekasse → weiterleiten an <strong>tamara.braun@augenzentrum-moossee.ch</strong> mit <strong>michael.pasquale@augenzentrum-suhr.ch im CC</strong></li>
  <li>Michael gibt die Zahlung bei der Ärztekasse in Auftrag</li>
</ol>
<h3>Rückzahlungen</h3>
<ol>
  <li>Info an tamara.braun@augenzentrum-moossee.ch mit michael.pasquale@augenzentrum-suhr.ch im CC</li>
  <li>Auf Info von Tamara warten (sollte Michael im CC haben)</li>
</ol>
<h3>Standard-Rechnungsabschnitte</h3>
<ul>
  <li>Die ersten beiden Rechnungsabschnitte werden bei Standarduntersuchungen immer verrechnet</li>
  <li>Abschnitt Nr. 1 (Aktenstudium) nur hinzufügen, wenn Unterlagen bearbeitet wurden</li>
  <li>Abschnitte 2–5 nur bei vorhandenem Konsultationseintrag</li>
</ul>
<h3>Wichtige Tarmed-Codes</h3>
<table>
  <thead><tr><th>Code</th><th>Leistung</th></tr></thead>
  <tbody>
    <tr><td>00.0050</td><td>Untersuchung 6–75 Jahre</td></tr>
    <tr><td>00.0055</td><td>Untersuchung &lt;6 oder &gt;75 Jahre</td></tr>
    <tr><td>08.0220</td><td>Augendruck</td></tr>
    <tr><td>08.0340</td><td>Gesichtsfeld</td></tr>
    <tr><td>08.1110</td><td>Fundus / OCT (nicht diagnoseentscheidend)</td></tr>
    <tr><td>08.0040</td><td>Sehtest</td></tr>
    <tr><td>00.2285</td><td>HA-Bericht</td></tr>
  </tbody>
</table>`
          },
        ]
      },
    ]
  },

  {
    title: 'Kataraktoperation (KAT)', color: 'red', subsections: [
      {
        title: 'Vorbereitung', pages: [
          {
            title: '2 Wochen vor der KAT-OP',
            content: `<h2>Vorbereitung KAT-OP – 2 Wochen vorher</h2>
<ol>
  <li>Patienten-Mappen vorbereiten: Blätter ausdrucken, Rezepte beilegen</li>
  <li><strong>KAT-Chargenblatt</strong> aus OneDrive ausdrucken:<br>
    <em>Augenzentren → Schönbühl → SB-OP → #2 Katarakt → Chargenblatt</em></li>
  <li><strong>Biometrie / IOL-Berechnung</strong> aus dem Liris ausdrucken</li>
  <li><strong>IOL-Berechnungen per E-Mail</strong> prüfen (Medilas oder Hoff IOL Berechnung) → Mailanhang suchen und ganzen Mailverlauf ausdrucken</li>
  <li>Blätter mit Christian besprechen</li>
  <li><strong>Sermax anrufen</strong> (Frau Grljic 079 197 77 16) für OP-Sterilisationsplanung – grosszügigen Verzug einplanen, so früh wie möglich anrufen</li>
  <li>OP-Plan an Aksana senden</li>
</ol>`
          },
          {
            title: 'Tag vor der KAT-OP',
            content: `<h2>Tag vor der KAT-OP</h2>
<ol>
  <li>Prüfen: Haben alle Patienten die <strong>Einwilligungserklärungen (EV)</strong> und <strong>Hausarztvisum (HV)</strong> unterschrieben?
    <ul>
      <li><strong>EV muss vorhanden sein</strong> – keine OP ohne EV</li>
      <li>EVs sollten beim BIO-Termin abgelegt sein</li>
      <li>HV sollte vorhanden sein (sonst keine Terminvergabe)</li>
      <li>Traumnarkose: EV und Anamneseblatt werden extern geprüft</li>
    </ul>
  </li>
  <li>Geschirrspüler leeren; prüfen ob Zucker und Milch vorhanden</li>
  <li><strong>OP-Tagesplan ausdrucken</strong> (2×: 2× OP selbst, 1× OP-Vorraum, bei Bedarf für Empfang)<br>
    <em>OneDrive → Augenzentren → Schönbühl → SB-OP → #2 Katarakt</em></li>
  <li><strong>Implantations-Meldeblatt ausdrucken</strong><br>
    <em>OneDrive → … → #2 Katarakt → Impl-Meldung</em></li>
  <li>Kontrolle: Sind alle Mappen vorbereitet? Ist alles gedruckt?</li>
  <li>Laptop in den OP bringen (Checkliste beachten)</li>
  <li>Person für die Croissants bestimmen – vorbestellen falls möglich:<br>
    1 Croissant pro Patient, 1 Sandwich für Christian + OP-Helfer</li>
</ol>`
          },
          {
            title: 'OP-Tag – Ablauf',
            content: `<h2>KAT-OP Tag</h2>
<h3>Morgens</h3>
<ol>
  <li>Croissants abholen und vorbereiten</li>
  <li>Arbeitsteilung im Team absprechen</li>
</ol>
<h3>OP-Vorbereitung (pro Patient)</h3>
<ol>
  <li>1× Mix-Tropfen geben</li>
  <li>Patienten einkleiden – genug Kleider vorhanden?</li>
  <li>Aufklärungsunterlagen nach OP bereit legen</li>
  <li>Augenklappen bereit legen</li>
</ol>
<h3>Rezepte vorbereiten (Ausstellung 1 Woche vor OP, per Post senden)</h3>
<ul>
  <li><strong>Tobradex:</strong> 3× täglich, 4 Wochen</li>
  <li><strong>Nevanac:</strong> 2× täglich, 4 Wochen</li>
</ul>
<h3>Kaffee und Croissants verteilen</h3>
<h3>Während der OP</h3>
<ul>
  <li>Telefon und Administratives</li>
  <li>Biometrie (falls Termine)</li>
</ul>
<h3>Nach den Operationen (Zuständigkeit)</h3>
<ol>
  <li>Chargenblätter einscannen und ablegen</li>
  <li>OP-Bericht erstellen und verrechnen</li>
</ol>`
          },
          {
            title: 'Präoperative Desinfektion',
            content: `<h2>Präoperative Desinfektion – KAT OP</h2>
<p><em>Gesamter Vorgang ca. 2–3 Minuten</em></p>
<ol>
  <li>Mit <strong>Betadinelösung</strong> (unverdünnt, standardisiert) <strong>3× die Haut</strong> rund um das Auge desinfizieren:
    <ul>
      <li>Ca. 5 cm Umkreis: über die Augenbraue bis Nasenspitzenhöhe</li>
      <li>Am / auf dem Lid anfangen und nach aussen hin desinfizieren</li>
      <li><strong>Einwirkzeit einhalten!</strong></li>
    </ul>
  </li>
  <li><strong>Betadine-BSS-Mischung 1:9</strong> in 5 ml Spritze aufziehen → Auge damit ausspülen</li>
  <li>Sanftes Trocknen der Abdeckzone mittels steriler Kompresse</li>
  <li>Abdecken</li>
</ol>`
          },
        ]
      },
      {
        title: 'Nach der Operation', pages: [
          {
            title: 'Patienteninfo nach KAT-OP',
            content: `<h2>Verhalten nach der Kataraktoperation</h2>
<h3>Augenschutz</h3>
<ul>
  <li>Schutzbrille oder eigene Brille tagsüber tragen</li>
  <li>Verband mit der Schale zur Nacht</li>
</ul>
<h3>Erlaubt nach der Operation</h3>
<ul>
  <li>Geschlossenes Auge mit Wasser waschen (ohne darauf zu drücken)</li>
  <li>Duschen, Baden, Haare waschen (Kopf nach hinten – kein Wasser ins Auge)</li>
  <li>Lesen, Fernsehen und leichte Hausarbeiten</li>
  <li>Heben von leichten Gegenständen (max. 20 kg)</li>
  <li>Spazieren gehen</li>
</ul>
<h3>Verboten nach der Operation</h3>
<ul>
  <li>Im Auge reiben</li>
  <li>Arbeiten in stark staubiger / schmutziger Umgebung (Stall, Schreinerei, Garten etc.)</li>
  <li>Anstrengender Sport (Joggen, Velofahren, Schwimmen etc.)</li>
</ul>
<h3>⚠️ Warnsignale – sofort zum Augenarzt</h3>
<ul>
  <li>Zunehmende Schmerzen, Rötung, Tränenfluss</li>
  <li>Starker Juckreiz, gerötete / geschwollene Lider</li>
  <li>Sehverschlechterung</li>
  <li>Neu auftretende Schatten beim Sehen</li>
</ul>`
          },
        ]
      },
      {
        title: 'IOL-Implantat-Beratung', pages: [
          {
            title: 'Gespräch Implantat (IOL-Beratung)',
            content: `<h2>IOL-Implantat-Beratung – Ablauf</h2>
<h3>Zeitpunkt</h3>
<p>Nach der ersten Mix-Tropfen-Gabe den Patienten in einen Raum nehmen.</p>
<h3>Einstieg</h3>
<p>«Mein Name ist [Name], ich informiere Sie über die zwei Implantatoptionen für die Grauer-Star-Operation.»</p>
<h3>Linsen erklären</h3>
<table>
  <thead><tr><th></th><th>Monofokale Linse</th><th>Multifokale Linse (MicroF)</th></tr></thead>
  <tbody>
    <tr><td><strong>Sehen</strong></td><td>Ferne exzellent; Lesen mit Brille</td><td>Ferne und Nähe brillenfrei</td></tr>
    <tr><td><strong>Preis</strong></td><td>CHF 450.– pro Auge</td><td>CHF 1 850.– pro Auge</td></tr>
    <tr><td><strong>Besonderheit</strong></td><td>Brille als Unterstützung nötig</td><td>Nachts bei grossen Pupillen: leichte Halos / Lichthöfe möglich (Bild zeigen) – kein eingeschränktes Sehen</td></tr>
  </tbody>
</table>
<h3>Empfehlung dokumentieren</h3>
<p>Empfehlung im Terminplan / Liris vermerken.</p>`
          },
        ]
      },
    ]
  },

  {
    title: 'IVT-Injektionen', color: 'teal', subsections: [
      {
        title: 'Vorbereitung & Abläufe', pages: [
          {
            title: 'IVT-Vorbereitung – Eylea (5 Schritte)',
            content: `<h2>IVT-Vorbereitung – Eylea</h2>
<p>Die Vorbereitung erfolgt in 5 Schritten (Schulungsvideos in OneDrive → AZM OneNote → IVT-Vorbereitung).</p>
<h3>Überblick Schritte</h3>
<ol>
  <li><strong>Schritt 1:</strong> Material bereitstellen und Hände waschen</li>
  <li><strong>Schritt 2:</strong> Medikament (Eylea) aufziehen unter aseptischen Bedingungen</li>
  <li><strong>Schritt 3:</strong> Patienten lagern (Rückenlage, Knierolle)</li>
  <li><strong>Schritt 4:</strong> Desinfektion des Auges mit verdünntem Betadine</li>
  <li><strong>Schritt 5:</strong> Injektion und Nachbetreuung</li>
</ol>
<h3>IVT-Anmeldung (Nachkontrolle)</h3>
<ol>
  <li>Mappe mit Injektionsdaten hervorholen</li>
  <li>Christian trägt nächsten Termin ein</li>
  <li>Anmeldung mit neuem Injektionsdatum zur OP-Planung Ophthalmologie</li>
</ol>
<h3>Neuer IVT-Patient</h3>
<ol>
  <li>Einwilligungserklärung abgeben (zwingend!)</li>
  <li>Brief vom Inselspital als Anhang beilegen</li>
</ol>`
          },
          {
            title: 'Jetrea-Injektion – Schema',
            content: `<h2>Jetrea (Ocriplasmin) Injektion – Schema</h2>
<h3>Patientenvorbereitung</h3>
<ol>
  <li>Tetracaine 1% AT Monodosis applizieren</li>
  <li>Longuette 10×20 cm ans zu operierende Auge kleben</li>
  <li>Kreuz mit Skinmarker markieren</li>
  <li>Unterschriebene Einwilligungserklärung anfordern</li>
  <li>Lagerung: Rückenlage auf Ophthastuhl mit Knierolle</li>
</ol>
<h3>Material</h3>
<ul>
  <li>Injektionsset (Handschuhe im Set enthalten)</li>
  <li>2× 10 ml Spritzen</li>
  <li>Jetrea 0.375 mg/0.3 ml (Gefrierfach Labor) – <strong>Kontrolle ob Ampulle vorhanden!</strong></li>
  <li>1 ml Spezialspritze mit Feingraduierung mit Luer Lock</li>
  <li>1 BD Microlance 3 Kanüle grün zum Aufziehen (21G × 1½, REF 304432)</li>
  <li>1 STERICAN Kanüle Braun (0.30 mm × 12.7 mm, Ref. 4656300)</li>
</ul>
<h3>Medikament vorbereiten</h3>
<ol>
  <li>Jetrea erst aus dem Gefrierfach holen, wenn Christian mit der Desinfektion beginnt</li>
  <li>Anweisung der Firma beachten! (Auftauen, rasches Aufziehen, rasche Verabreichung)</li>
  <li>BD Microlance grüne Kanüle zum Aufziehen verwenden → danach Kanüle verwerfen</li>
  <li>30G STERICAN Kanüle aufsetzen; 0.1 ml Markierung einstellen (luftleer) – überschüssiges Volumen vor Injektion entfernen</li>
  <li>Medikament <strong>sofort</strong> spritzen!</li>
</ol>
<h3>Vorgehen</h3>
<ol>
  <li>Desinfektion im Auge mit Betadine verdünnt 1:10, <strong>90 Sek. warten</strong></li>
  <li>Spülen des Auges mit NaCl</li>
  <li>Lochtuch anlegen, Lidsperrer einsetzen</li>
  <li>Messzirkel: 3.5 mm abmessen</li>
  <li>Injektion gemäss obiger Anweisung</li>
  <li>Test Handbewegung durch Operateur</li>
  <li>Feuchte Kompresse zum Abwaschen von Betadine</li>
</ol>
<h3>Nachbereitung</h3>
<p>Nach Injektion Patient <strong>20 Minuten flach</strong> liegend bei uns lassen.</p>
<p><em>Hinweis: Es gibt keine deutsche Anwendungsdokumentation – englische Version mit Bleistiftübersetzung wird verwendet (aus rechtlichen Gründen keine eigene erstellt).</em></p>`
          },
        ]
      },
    ]
  },

  {
    title: 'Lideingriffe', color: 'orange', subsections: [
      {
        title: 'OP-Schemas', pages: [
          {
            title: 'Allgemeines zu Lideingriffen',
            content: `<h2>Lideingriffe – Allgemeines</h2>
<h3>Einwilligung</h3>
<p>Lideingriffe erhalten <strong>immer eine separate Einwilligungserklärung</strong> speziell für Lideingriffe (nicht dieselbe wie für KAT-OP).</p>
<h3>Häufige Eingriffe</h3>
<ul>
  <li>Blepharochalasis (Schlupflider)</li>
  <li>Chalazionentfernung (Hagelkorn)</li>
  <li>Entropiumkorrektur (einwärts gedrehtes Lid)</li>
  <li>Ptosis (hängendes Augenlid)</li>
  <li>Pterygiumentfernung (Flügelfell)</li>
  <li>Tränenwegsondierung / Plug- oder Stenteinlage</li>
  <li>Weichteilexzision Augen</li>
</ul>
<h3>Vorbereitung</h3>
<ul>
  <li>Entsprechende OP-Schema-Checkliste aus den Dokumenten bereit legen</li>
  <li>OP-Schemas befinden sich in OneDrive → AZM OneNote → OP-Schemas</li>
  <li>Einwilligungserklärung für Lideingriff vorbereiten und unterschreiben lassen</li>
</ul>
<p><strong>Tipp:</strong> Die detaillierten OP-Schemata (Schritt-für-Schritt-Anleitungen) für jeden einzelnen Eingriff sind in den entsprechenden Word-Dokumenten auf OneDrive abgelegt.</p>`
          },
        ]
      },
    ]
  },

  {
    title: 'Administration', color: 'amber', subsections: [
      {
        title: 'Post & Organisation', pages: [
          {
            title: 'Post & Patientenmappe',
            content: `<h2>Post & Patientenmappe</h2>
<h3>Tagespost</h3>
<ul>
  <li>Eingehende Post sichten und verteilen</li>
  <li>Christian: Post ins Fach auf den Arbeitstisch legen</li>
  <li>Weitere Ärzte: in jeweiliges Fach legen</li>
</ul>
<h3>Anmeldungen Inselspital</h3>
<ol>
  <li>Nach dem Faxen die Anmeldung kopieren</li>
  <li>Kopie in Christians Fach legen (damit er sie in seinen Ordner ablegen kann)</li>
  <li>Eine interne Agenda führen: welche Patienten ans Inselspital geschickt wurden → in Ordner ablegen</li>
</ol>
<h3>Checkliste bei Ärzteabwesenheit</h3>
<p>Checkliste für Tage ohne Arzt befindet sich in OneDrive:<br>
<em>Augenzentren → Schönbühl → 2_SB-Dokumentation → 1 SB-Leitfaden → Checklisten bei Ärzteabwesenheit</em></p>`
          },
        ]
      },
      {
        title: 'Abschluss des Tages', pages: [
          {
            title: 'Tagesabschluss – Berichte & Rechnungen',
            content: `<h2>Tagesabschluss</h2>
<h3>Rechnungen & Berichte</h3>
<ul>
  <li>Alle Tagesberichte und Rechnungen müssen am Abend <strong>fertig und abgeschlossen</strong> sein</li>
  <li>Alle HA-Berichte und Arztbriefe erledigen</li>
</ul>
<h3>Liris & Praxismanager</h3>
<ul>
  <li>Alle Konsultationseinträge vollständig abschliessen</li>
  <li>Keine offenen Konsultationen liegen lassen</li>
</ul>
<h3>Flächendesinfektion</h3>
<ul>
  <li>Alle Arbeitsflächen abwischen</li>
  <li>Spaltlampe reinigen</li>
  <li>Tisch im Untersuchungszimmer wischen</li>
</ul>
<h3>Materialien auffüllen</h3>
<ul>
  <li>Tupfer, Stäbchen, Alkohol auffüllen</li>
  <li>Augentropfen auffüllen (so einsetzen, dass sie beim Öffnen nicht über die Finger laufen)</li>
  <li>Druckmessproben reinigen und ins Desinfektionsbad</li>
</ul>`
          },
        ]
      },
    ]
  },
]
// ─────────────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('Seeding Onboarding SOPs...')
  for (let si = 0; si < SECTIONS.length; si++) {
    const sec = SECTIONS[si]
    console.log(`  Section: ${sec.title}`)
    const secId = await addSection(sec.title, sec.color, si)
    for (let ssi = 0; ssi < sec.subsections.length; ssi++) {
      const sub = sec.subsections[ssi]
      console.log(`    Subsection: ${sub.title}`)
      const subId = await addSubsection(secId, sub.title, ssi)
      for (let pi = 0; pi < sub.pages.length; pi++) {
        const pg = sub.pages[pi]
        console.log(`      Page: ${pg.title}`)
        await addPage(subId, secId, pg.title, pg.content, pi)
      }
    }
  }
  console.log('Done! ✅')
  process.exit(0)
}

seed().catch(e => { console.error(e); process.exit(1) })
