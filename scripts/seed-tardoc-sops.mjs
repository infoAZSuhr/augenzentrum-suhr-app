/**
 * Einmaliges (idempotentes) Seed-Skript: Erstellt die SOP-Section
 * "H – TARDOC-Abrechnung & Tarife" mit 8 Pages in Firestore.
 *
 * Ausführen:
 *   node scripts/seed-tardoc-sops.mjs
 *
 * Voraussetzungen:
 *   - npm install (für firebase-Modul)
 *   - Admin-Login (E-Mail + Passwort) mit Schreibrechten auf onboarding_*
 *
 * Idempotenz: Prüft vorher, ob die Section bereits existiert. Falls ja → Abbruch.
 * Bei Bedarf erneut ausführen: vorher die Section in der App löschen.
 *
 * Stand: 30.05.2026 · TARDOC 1.4c · Ambulante Pauschalen 1.1c
 */
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, inMemoryPersistence, setPersistence } from 'firebase/auth'
import { getFirestore, collection, addDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore'
import { createInterface } from 'readline'

// ── Firebase config (gleicher Stand wie src/lib/firebase.ts) ─────────────────
const app = initializeApp({
  apiKey:            'AIzaSyAYRnIZJ46oEPUIZ9uRiLDbTWW0dB93vgQ',
  authDomain:        'azsdb-999d6.firebaseapp.com',
  projectId:         'azsdb-999d6',
  storageBucket:     'azsdb-999d6.firebasestorage.app',
  messagingSenderId: '782091866487',
  appId:             '1:782091866487:web:4616ff6bf7cce1e15c1172',
})
const auth = getAuth(app)
const db   = getFirestore(app)

// ── Collection-Namen (identisch mit src/lib/firestoreOnboarding.ts) ──────────
const S_COL  = 'onboarding_sections'
const SS_COL = 'onboarding_subsections'
const P_COL  = 'onboarding_pages'

const SECTION_TITLE = 'H – TARDOC-Abrechnung & Tarife'
const SECTION_COLOR = 'cyan'
const SUBSECTION    = 'TARDOC-Abrechnung & Tarife'

// ── SOP-Inhalte (HTML für TipTap RichTextEditor) ─────────────────────────────
// Jede Page: { title, content (HTML) }
// Quellen am Ende jeder Seite, damit jede Seite eigenständig nutzbar ist.

const SOURCES_BLOCK = `
<h3>Quellen</h3>
<ul>
  <li><a href="https://www.tardoc-online.ch/">TARDOC Online Browser (Version 1.4c)</a></li>
  <li><a href="https://oaat-otma.ch/tardoc/tarifbrowser">OAAT-Tarifbrowser (TARDOC + Ambulante Pauschalen)</a></li>
  <li><a href="https://tarifeambulant.fmh.ch/">FMH Informationsplattform TARDOC und Ambulante Pauschalen</a></li>
  <li><a href="https://www.bag.admin.ch/de/ambulanter-arzttarif">BAG – Ambulanter Arzttarif</a></li>
</ul>`

const PAGES = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    title: 'H.1 Standard-Konsultation mit Bildgebung',
    content: `
<h2>Anlass</h2>
<p>Reguläre ophthalmologische Konsultation mit kompletter Standortbestimmung — z.B. jährliche Diabetes-Kontrolle, Glaukom-Verlauf, AMD-Verlauf.</p>

<h2>Standardpaket pro Sitzung</h2>
<p>Folgende Positionen sind in derselben Sitzung kumulierbar und werden bei jeder vollständigen Standortbestimmung regelmässig kombiniert abgerechnet:</p>
<table>
  <thead>
    <tr><th>Ziffer</th><th>Bezeichnung</th><th>Limit pro Sitzung</th></tr>
  </thead>
  <tbody>
    <tr><td><strong>AA.00.0010</strong></td><td>Ärztliche Konsultation, erste 5 Min.</td><td>1×</td></tr>
    <tr><td><strong>AA.00.0020</strong></td><td>+ jede weitere 1 Min.</td><td>nach effektiver Zeit</td></tr>
    <tr><td><strong>AK.00.0100</strong></td><td>Nichtärztliche ophthalmologische Leistungen (MPA), pro Min.</td><td>nach effektiver Zeit</td></tr>
    <tr><td><strong>RC.00.0010</strong></td><td>Refraktionsbestimmung, subjektiv, beidseitig</td><td>1×</td></tr>
    <tr><td><strong>RC.05.0010</strong></td><td>Applanationstonometrie + stereoskopische Papillenbeurteilung, beidseitig</td><td>1×</td></tr>
    <tr><td><strong>RC.40.0020</strong></td><td>Spaltlampe vordere Augenabschnitte, beidseitig</td><td>1×</td></tr>
    <tr><td><strong>RC.70.0010</strong></td><td>Biomikroskopie des zentralen Fundus</td><td>1×</td></tr>
    <tr><td><strong>RC.70.0020</strong></td><td>+ Zuschlag Fundusperipherie, pro Seite</td><td>max. 2×, max. 1×/Seite</td></tr>
    <tr><td><strong>RC.35.0110</strong></td><td>Fundusaufnahmen, beidseitig (bei Bildgebung)</td><td>1×</td></tr>
    <tr><td><strong>AR.00.0250</strong></td><td>Wechselzeit Sparte Ophthalmologische Photographie</td><td>1×</td></tr>
  </tbody>
</table>

<h2>Begründung gegenüber Versicherern</h2>
<p>Diese Kombination wurde im TARDOC RC-Kapitel ausdrücklich als kumulierbar definiert. Jede Einzelposition trägt einen unterschiedlichen Untersuchungsaspekt zu einem vollständigen ophthalmologischen Status bei (Refraktion, Druck, vorderer Abschnitt, hinterer Abschnitt, Peripherie).</p>

${SOURCES_BLOCK}`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    title: 'H.2 OCT / Fundus – Limitationen und Intervalle',
    content: `
<h2>Tarifliche Limitationen pro Sitzung</h2>
<table>
  <thead>
    <tr><th>Ziffer</th><th>Bezeichnung</th><th>Limit</th></tr>
  </thead>
  <tbody>
    <tr><td><strong>RC.35.0100</strong></td><td>Fundusaufnahmen, einseitig</td><td>max. 1× pro Seite</td></tr>
    <tr><td><strong>RC.35.0110</strong></td><td>Fundusaufnahmen, beidseitig</td><td>max. 1× pro Sitzung</td></tr>
    <tr><td><strong>RC.35.0130</strong></td><td>Fundus-Panorama, beidseitig</td><td>max. 1× pro Sitzung</td></tr>
    <tr><td><strong>RC.35.0160</strong></td><td>OCT vorderer Augenabschnitt, pro Seite</td><td>max. 2×, max. 1×/Seite</td></tr>
    <tr><td><strong>RC.35.0170</strong></td><td>Schnittbild hinterer Augenabschnitt (OCT Netzhaut), pro Seite</td><td>max. 2×, max. 1×/Seite</td></tr>
    <tr><td><strong>RC.35.0190</strong></td><td>OCT-Angiografie, pro Seite</td><td>gemäss Tarif</td></tr>
  </tbody>
</table>

<h3>Wichtige Inkompatibilitäten</h3>
<ul>
  <li><strong>RC.35.0110</strong> (beidseitig) ist nicht kumulierbar mit <strong>RC.35.0100</strong> (einseitig) oder <strong>RC.35.0130</strong> (Panorama) auf derselben Sitzung.</li>
  <li><strong>RC.35.0170</strong> (Netzhaut-OCT) ist nicht kumulierbar mit <strong>RC.35.0080</strong> (Scanning-Laser-Ophthalmoskopie) oder <strong>RC.35.0190</strong> (OCT-Angiografie) auf derselben Seite.</li>
</ul>

<h2>Keine Jahres-Limitation im TARDOC – aber WZW-Kriterien (KVG Art. 32)</h2>
<p>Der TARDOC selbst legt <strong>keine absolute Jahres- oder Mindestabstandsregel</strong> fest. Was die Wiederholungshäufigkeit faktisch begrenzt, sind die WZW-Kriterien (Wirksamkeit, Zweckmässigkeit, Wirtschaftlichkeit). Versicherer können Rückforderungen stellen, wenn die Häufigkeit nicht medizinisch begründbar ist.</p>

<h3>Praxisübliche Frequenz</h3>
<table>
  <thead>
    <tr><th>Klinische Situation</th><th>Frequenz Fundus / OCT</th></tr>
  </thead>
  <tbody>
    <tr><td>Diabetes mellitus ohne Retinopathie</td><td>1× pro Jahr</td></tr>
    <tr><td>Nicht-proliferative DR, mild bis moderat</td><td>alle 6–12 Monate</td></tr>
    <tr><td>Schwere nicht-proliferative DR / proliferative DR</td><td>alle 3–6 Monate</td></tr>
    <tr><td>Diabetisches Makulaödem (DMÖ) ohne Therapie</td><td>alle 3 Monate</td></tr>
    <tr><td>DMÖ unter Anti-VEGF-Therapie (IVT)</td><td>monatlich vor jeder Injektion</td></tr>
    <tr><td>Glaukom-Verdacht / etabliertes Glaukom</td><td>OCT-Papille 1–2× pro Jahr</td></tr>
    <tr><td>Postoperativ (z.B. nach Katarakt-OP mit OCT-Indikation)</td><td>nach klinischer Notwendigkeit</td></tr>
  </tbody>
</table>

<p><em>Bei stabiler Situation und fehlender Indikation ist häufige OCT zwar tariflich erlaubt, aber wirtschaftlich nicht vertretbar. Bei dokumentierter Indikation (Befundänderung, Therapieverlauf, DMÖ unter IVT) ist sie jederzeit – sogar mehrfach pro Sitzung pro Seite (max. 2×/Sitzung) – abrechenbar.</em></p>

${SOURCES_BLOCK}`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    title: 'H.3 Kinder-Zuschläge – was Augenärzte dürfen und was nicht',
    content: `
<h2>Achtung: CG.15.0010 ist NICHT für Augenärzte</h2>
<p><strong>CG.15.0010</strong> (Zuschlag für Leistungen bei Kindern bis 12 Jahren, 13.82 TP) ist tariflich explizit auf folgende drei Qualitative Dignitäten beschränkt:</p>
<ul>
  <li><strong>1100</strong> Kinder- und Jugendmedizin (Pädiater)</li>
  <li><strong>1500</strong> Kinder- und Jugendpsychiatrie</li>
  <li><strong>1900</strong> Kinderchirurgie</li>
</ul>
<p>Augenärzte (Dignität <strong>0800 Ophthalmologie</strong>) dürfen diese Position <strong>nicht</strong> abrechnen. Validierungs-Software (WinMed/Opale) weist die Position automatisch zurück.</p>

<h2>Keine pauschalen Kinder-Zuschläge mehr im TARDOC</h2>
<p>TARMED 00.0025 (Konsultationszuschlag bei Kindern unter 6 Jahre / Senioren über 75 Jahre) wurde <strong>abgeschafft</strong>. TARDOC kennt keine pauschalen Altersaufschläge mehr für Konsultationen.</p>
<p><strong>Stattdessen</strong>: Da TARDOC ab der 6. Minute minutengenau abgerechnet wird, kompensiert sich die längere Untersuchungszeit bei Kindern automatisch über mehr Zeit-Positionen <strong>AA.00.0020</strong>.</p>

<h2>Was Augenärzte bei Kindern zusätzlich abrechnen dürfen</h2>
<table>
  <thead>
    <tr><th>Ziffer</th><th>Bezeichnung</th><th>Altersgrenze</th><th>TP (AL+TL)</th><th>Limitation</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>RC.15.0100</strong></td>
      <td>Orientierende Motilitäts- und Stereopsisprüfung bei Kindern, beidseitig</td>
      <td>≤ 7 Jahre</td>
      <td>10.56 + 12.92</td>
      <td>max. 1× pro Sitzung. Nicht kumulierbar mit RC.15.0030 (Orthoptischer Status)</td>
    </tr>
    <tr>
      <td><strong>RC.25.0050</strong></td>
      <td>+ Zuschlag für Tränenwegsondierung bei Kindern</td>
      <td>≤ 7 Jahre (+ 30 Tage)</td>
      <td>10.56 + 12.92</td>
      <td>Zuschlagsleistung zur Tränenwegsondierung. Nicht beim narkotisierten Kind</td>
    </tr>
  </tbody>
</table>

${SOURCES_BLOCK}`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    title: 'H.4 Zykloplegie beim Kind – Abrechnung und Wartezeit',
    content: `
<h2>Hauptleistung: RC.00.0090</h2>
<p><strong>RC.00.0090</strong> – Refraktionsbestimmung mit Cykloplegie, objektiv</p>
<ul>
  <li>AL 10.70 TP + TL 14.41 TP, 5 Min</li>
  <li><strong>max. 2× pro Sitzung, max. 1× pro Seite</strong> → also je Auge 1× bei beidseitiger Untersuchung</li>
  <li>Kumulierbar mit AR.00.0210 (Wechselzeit klinische ophthalmologische Diagnostik)</li>
</ul>
<p>Diese Position deckt die objektive Refraktion in Zykloplegie ab (Skiaskopie, Retinoskopie, automatisches Refraktometer in Zykloplegie).</p>

<h2>Was zusätzlich in derselben Sitzung abrechenbar ist</h2>
<ul>
  <li><strong>AK.00.0100</strong> für die MPA-Minuten (Tropfen-Applikation, ca. 3–5 Min)</li>
  <li><strong>RC.00.0010</strong> subjektive Refraktion, falls beim Kind möglich</li>
  <li>Übrige Standortbestimmung (RC.05.0010, RC.40.0020, RC.70.0010 etc.)</li>
  <li><strong>AR.00.0210</strong> Wechselzeit klinische ophthalmologische Diagnostik (bei Spartenwechsel)</li>
</ul>

<h2>WICHTIG: Was NICHT abrechenbar ist</h2>
<ul>
  <li><strong>Reine Wartezeit</strong> auf den Wirkungseintritt der Zykloplegika (Kind sitzt im Wartebereich, 30–45 Min) — keine aktive ärztliche oder nichtärztliche Leistung.</li>
  <li><strong>AA.00.0010/0020 nicht künstlich ausreizen</strong>: Konsultations-Minuten dürfen nur die effektiv aktive Patient-Arzt-Zeit umfassen (Anamnese, Untersuchung, Beratung). Auffüllen bis zum Maximum → erhebliches Rückforderungs-Risiko durch Versicherer-Trustcenter via WZW-Statistik.</li>
</ul>

<h2>Workflow-Tipp</h2>
<p>Die Wartezeit organisatorisch nutzen — parallel einen anderen Patienten beraten. Der Praxisraum bleibt zwar belegt, aber der Arzt nicht. Termin-Slots so legen, dass Zykloplegie-Patienten und reguläre Konsultationen sich überlappen können.</p>

<h2>Saubere Abrechnung einer Zykloplegie-Konsultation – Schritt für Schritt</h2>
<table>
  <thead>
    <tr><th>Phase</th><th>Tarifziffer</th><th>Abrechnung</th></tr>
  </thead>
  <tbody>
    <tr><td>Begrüssung, Anamnese, Vorbefund</td><td>AA.00.0010 (1×) + AA.00.0020 (Min)</td><td>nach effektiver Zeit</td></tr>
    <tr><td>MPA legt Zykloplegika-Tropfen + erklärt</td><td>AK.00.0100</td><td>effektive MPA-Zeit (3–5 Min)</td></tr>
    <tr><td><strong>Wartezeit auf Wirkung (Kind im Wartebereich)</strong></td><td>—</td><td><strong>keine Abrechnung</strong></td></tr>
    <tr><td>Refraktion subjektiv (falls möglich)</td><td>RC.00.0010</td><td>1×</td></tr>
    <tr><td><strong>Refraktion objektiv in Zykloplegie</strong></td><td><strong>RC.00.0090</strong></td><td>2× (je Auge 1×)</td></tr>
    <tr><td>Übrige Standortbestimmung (Spaltlampe, Fundus, Tonometrie)</td><td>RC.40.0020, RC.70.0010 etc.</td><td>wie bei jeder Untersuchung</td></tr>
    <tr><td>Aktive Nach-Aufklärung, Brillen-Verordnung</td><td>AA.00.0020 + RC.00.0020</td><td>nach effektiver Zeit</td></tr>
  </tbody>
</table>

${SOURCES_BLOCK}`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    title: 'H.5 ICD-10-GM Diagnose-Codes für Ophthalmologie',
    content: `
<h2>Pflicht zur Diagnose-Angabe</h2>
<p>Bei jeder Rechnung muss mindestens <strong>eine</strong> ICD-Diagnose angegeben werden (KVG-Tarifvertrag). In der Schweiz wird <strong>ICD-10-GM</strong> verwendet. Bei ambulanten Pauschalen wird die <strong>Primärdiagnose</strong> (Hauptgrund des Patientenkontakts) erfasst — daraus leitet der Grouper die korrekte Pauschale ab.</p>

<h2>Häufige Diagnosen – Augenheilkunde (Kapitel H00–H59)</h2>

<h3>H00–H06 – Lider, Tränenapparat, Orbita</h3>
<table>
  <thead><tr><th>Code</th><th>Diagnose</th></tr></thead>
  <tbody>
    <tr><td>H00.0</td><td>Hordeolum</td></tr>
    <tr><td>H01.0</td><td>Blepharitis</td></tr>
    <tr><td>H02.0–H02.5</td><td>Entropium / Ektropium / Trichiasis / Lagophthalmus / Ptosis</td></tr>
    <tr><td>H04.0</td><td>Dakryoadenitis</td></tr>
    <tr><td>H04.5</td><td>Stenose / Insuffizienz der Tränenwege</td></tr>
  </tbody>
</table>

<h3>H10–H13 – Konjunktiva</h3>
<table>
  <thead><tr><th>Code</th><th>Diagnose</th></tr></thead>
  <tbody>
    <tr><td>H10.0</td><td>Akute mukopurulente Konjunktivitis</td></tr>
    <tr><td>H10.1</td><td>Akute atopische Konjunktivitis</td></tr>
    <tr><td>H10.4</td><td>Chronische Konjunktivitis</td></tr>
    <tr><td>H11.0</td><td>Pterygium</td></tr>
    <tr><td>H11.1</td><td>Pinguecula</td></tr>
  </tbody>
</table>

<h3>H15–H22 – Sklera, Kornea, Iris, Ziliarkörper</h3>
<table>
  <thead><tr><th>Code</th><th>Diagnose</th></tr></thead>
  <tbody>
    <tr><td>H16.0</td><td>Kornealulkus</td></tr>
    <tr><td>H16.2</td><td>Keratokonjunktivitis</td></tr>
    <tr><td>H18.4</td><td>Hornhautdegeneration</td></tr>
    <tr><td>H18.5</td><td>Hereditäre Hornhautdystrophie</td></tr>
    <tr><td>H18.6</td><td>Keratokonus</td></tr>
    <tr><td>H20.0</td><td>Akute Iridozyklitis</td></tr>
    <tr><td>H20.1</td><td>Chronische Iridozyklitis</td></tr>
  </tbody>
</table>

<h3>H25–H28 – Linse</h3>
<table>
  <thead><tr><th>Code</th><th>Diagnose</th></tr></thead>
  <tbody>
    <tr><td>H25.0</td><td>Cataracta senilis incipiens</td></tr>
    <tr><td>H25.1</td><td>Cataracta senilis nuclearis</td></tr>
    <tr><td>H25.2</td><td>Cataracta senilis, Morgagni-Typ</td></tr>
    <tr><td>H25.9</td><td>Cataracta senilis, n.n.bez.</td></tr>
    <tr><td>H26.0</td><td>Cataracta infantilis, juvenilis</td></tr>
    <tr><td>H26.4</td><td>Nachstar</td></tr>
  </tbody>
</table>

<h3>H30–H36 – Choroidea, Retina</h3>
<table>
  <thead><tr><th>Code</th><th>Diagnose</th></tr></thead>
  <tbody>
    <tr><td>H33.0</td><td>Netzhautablösung mit Netzhautriss</td></tr>
    <tr><td>H33.4</td><td>Traktionsbedingte Netzhautablösung</td></tr>
    <tr><td>H34.1</td><td>Zentraler Netzhautarterienverschluss</td></tr>
    <tr><td>H34.8</td><td>Sonstige Netzhautgefässverschlüsse (RVV)</td></tr>
    <tr><td>H35.0</td><td>Hintergrund-Retinopathie und Netzhautgefässveränderungen</td></tr>
    <tr><td>H35.3</td><td>Degeneration der Makula und des hinteren Pols (AMD)</td></tr>
    <tr><td>H35.31</td><td>Trockene AMD</td></tr>
    <tr><td>H35.32</td><td>Feuchte AMD</td></tr>
    <tr><td>H35.5</td><td>Hereditäre Netzhautdystrophie</td></tr>
    <tr><td>H35.7</td><td>Schichtspaltung der Netzhaut, Retinoschisis</td></tr>
    <tr><td><strong>H36.0*</strong></td><td><strong>Diabetische Retinopathie</strong> (immer mit E10–E14 als Primärcode!)</td></tr>
  </tbody>
</table>

<h3>H40–H42 – Glaukom</h3>
<table>
  <thead><tr><th>Code</th><th>Diagnose</th></tr></thead>
  <tbody>
    <tr><td>H40.0</td><td>Glaukomverdacht</td></tr>
    <tr><td>H40.1</td><td>Primäres Offenwinkelglaukom</td></tr>
    <tr><td>H40.2</td><td>Primäres Engwinkelglaukom</td></tr>
    <tr><td>H40.3</td><td>Sekundäres Glaukom durch Augentrauma</td></tr>
    <tr><td>H40.5</td><td>Sekundäres Glaukom (sonstige Ursache)</td></tr>
    <tr><td>H40.6</td><td>Glaukom durch Medikamente</td></tr>
  </tbody>
</table>

<h3>H43–H48 – Glaskörper, Sehnerv</h3>
<table>
  <thead><tr><th>Code</th><th>Diagnose</th></tr></thead>
  <tbody>
    <tr><td>H43.1</td><td>Glaskörperblutung</td></tr>
    <tr><td>H43.3</td><td>Sonstige Glaskörperopazitäten (Mouches volantes)</td></tr>
    <tr><td>H47.0</td><td>Erkrankungen des N. opticus</td></tr>
  </tbody>
</table>

<h3>H49–H52 – Augenmuskeln, Refraktion, Akkommodation</h3>
<table>
  <thead><tr><th>Code</th><th>Diagnose</th></tr></thead>
  <tbody>
    <tr><td>H49.0</td><td>Lähmung des N. oculomotorius</td></tr>
    <tr><td>H50.0</td><td>Esotropie</td></tr>
    <tr><td>H50.1</td><td>Exotropie</td></tr>
    <tr><td>H52.0</td><td>Hyperopie</td></tr>
    <tr><td>H52.1</td><td>Myopie</td></tr>
    <tr><td>H52.2</td><td>Astigmatismus</td></tr>
    <tr><td>H52.4</td><td>Presbyopie</td></tr>
    <tr><td>H52.6</td><td>Sonstige Refraktionsanomalien</td></tr>
    <tr><td>H52.7</td><td>Refraktionsanomalie, n.n.bez.</td></tr>
  </tbody>
</table>

<h3>H53–H54 – Sehstörungen, Blindheit</h3>
<table>
  <thead><tr><th>Code</th><th>Diagnose</th></tr></thead>
  <tbody>
    <tr><td>H53.0</td><td>Amblyopia ex anopsia</td></tr>
    <tr><td>H53.1</td><td>Subjektive Sehstörungen</td></tr>
    <tr><td>H53.4</td><td>Gesichtsfelddefekte</td></tr>
    <tr><td>H54.0</td><td>Blindheit beidseits</td></tr>
  </tbody>
</table>

<h3>H55–H59 – Sonstige</h3>
<table>
  <thead><tr><th>Code</th><th>Diagnose</th></tr></thead>
  <tbody>
    <tr><td>H57.1</td><td>Augenschmerzen</td></tr>
    <tr><td>H59.0</td><td>Postoperatives Hornhautödem</td></tr>
  </tbody>
</table>

<h2>Wichtige Codes ausserhalb Kapitel H</h2>
<table>
  <thead><tr><th>Code</th><th>Diagnose</th></tr></thead>
  <tbody>
    <tr><td>E10.3 / E11.3 / E13.3 / E14.3</td><td>Diabetes Typ 1 / 2 / Sonstige / N.n.bez., mit Augenkomplikationen</td></tr>
    <tr><td>E10.39 / E11.39 etc.</td><td>Diabetes mit n.n.bez. Augenkomplikation</td></tr>
    <tr><td>E14.90</td><td>Diabetes mellitus n.n.bez. ohne Komplikation</td></tr>
    <tr><td>Z01.0</td><td>Untersuchung der Augen und des Sehvermögens (Vorsorge)</td></tr>
    <tr><td>Z96.1</td><td>Vorhandensein intraokularer Linse (Z.n. Katarakt-OP)</td></tr>
    <tr><td>Z97.3</td><td>Vorhandensein Brille / Kontaktlinse</td></tr>
  </tbody>
</table>

<h2>Best Practice</h2>
<p>Bei diabetischer Retinopathie immer <strong>zwei</strong> Codes verwenden: Primär <strong>E11.3</strong> (Diabetes mit Augenkomplikation) + Sekundär <strong>H36.0</strong> (diabetische Retinopathie). Bei IVI-Therapie zusätzlich H35.31/H35.32 (AMD) oder H35.81 (DMÖ).</p>

<h3>Quellen</h3>
<ul>
  <li><a href="https://www.bfarm.de/DE/Kodiersysteme/Klassifikationen/ICD/ICD-10-GM/_node.html">BfArM – ICD-10-GM 2026</a></li>
  <li><a href="https://www.icd-code.de/icd/code/H00-H59.html">ICD-Code H00–H59 Kapitel VII Augenheilkunde</a></li>
</ul>`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    title: 'H.6 TARDOC Tarifziffern – Übersicht für Augenarztpraxis',
    content: `
<h2>Allgemeine Leistungen (AA / AK / AR)</h2>
<table>
  <thead><tr><th>Ziffer</th><th>Bezeichnung</th></tr></thead>
  <tbody>
    <tr><td>AA.00.0010</td><td>Konsultation, erste 5 Min.</td></tr>
    <tr><td>AA.00.0020</td><td>+ jede weitere 1 Min.</td></tr>
    <tr><td>AA.00.0030</td><td>Aktenstudium (in Abwesenheit des Patienten)</td></tr>
    <tr><td>AA.00.0080</td><td>Ärztliches Konsilium, pro 1 Min.</td></tr>
    <tr><td>AA.10.0010</td><td>Telemedizinische Konsultation, erste 5 Min.</td></tr>
    <tr><td>AA.10.0030</td><td>Telemed. zeitversetzte Konsultation</td></tr>
    <tr><td>AA.30.*</td><td>Notfall-/Dringlichkeits-Pauschalen (siehe H.8)</td></tr>
    <tr><td>AK.00.0100</td><td>Nichtärztliche ophth. Leistungen, pro 1 Min. (MPA)</td></tr>
    <tr><td>AR.00.0210</td><td>Wechselzeit Sparte Klin. ophth. Diagnostik</td></tr>
    <tr><td>AR.00.0250</td><td>Wechselzeit Sparte Ophth. Photographie</td></tr>
  </tbody>
</table>

<h2>Komplette Übersicht RC-Kapitel (Auge)</h2>
<table>
  <thead><tr><th>Subkapitel</th><th>Bereich</th></tr></thead>
  <tbody>
    <tr><td>RC.00</td><td>Visus, Refraktion, Brille</td></tr>
    <tr><td>RC.05</td><td>Augendruck</td></tr>
    <tr><td>RC.10</td><td>Perimetrie</td></tr>
    <tr><td>RC.15</td><td>Orthoptik, Neuroophthalmologie</td></tr>
    <tr><td>RC.20</td><td>Farbsinn</td></tr>
    <tr><td>RC.25</td><td>Tränendrüse, Tränenwege</td></tr>
    <tr><td>RC.30</td><td>Konjunktiva</td></tr>
    <tr><td>RC.35</td><td>Ophthalmofotografische, -angiologische, -elektrische Untersuchungen</td></tr>
    <tr><td>RC.40</td><td>Diagnostik: Diverse</td></tr>
    <tr><td>RC.45</td><td>Therapie: Diverse</td></tr>
    <tr><td>RC.50</td><td>Augenlid</td></tr>
    <tr><td>RC.55</td><td>Kornea, Sklera</td></tr>
    <tr><td>RC.60</td><td>Iris</td></tr>
    <tr><td>RC.65</td><td>Linse</td></tr>
    <tr><td>RC.70</td><td>Retina</td></tr>
    <tr><td>RC.85</td><td>Transplantatentnahme (Augenbulbus, Kornea)</td></tr>
    <tr><td>RC.90</td><td>Seltene Leistungen</td></tr>
  </tbody>
</table>

<h2>Häufige RC-Einzelziffern in der Sprechstunde</h2>
<table>
  <thead><tr><th>Ziffer</th><th>Bezeichnung</th><th>Limit pro Sitzung</th></tr></thead>
  <tbody>
    <tr><td>RC.00.0010</td><td>Refraktion subjektiv, beidseits</td><td>1×</td></tr>
    <tr><td>RC.00.0020</td><td>Erweiterte Refraktion mit Brillen-/KL-Verordnung</td><td>1×</td></tr>
    <tr><td><strong>RC.00.0090</strong></td><td><strong>Refraktion in Cykloplegie, objektiv</strong></td><td>2×, 1×/Seite</td></tr>
    <tr><td>RC.00.0100</td><td>Kontaktlinsen-Anpassung</td><td>–</td></tr>
    <tr><td>RC.05.0010</td><td>Tonometrie + Papillenbeurteilung, beidseits</td><td>1×</td></tr>
    <tr><td>RC.05.0020</td><td>Augendruck-Tagesprofil, beidseits</td><td>1×</td></tr>
    <tr><td>RC.10.*</td><td>Perimetrie (Gesichtsfeld)</td><td>je nach Untertyp</td></tr>
    <tr><td>RC.15.0030</td><td>Orthoptischer Status, beidseits</td><td>1×</td></tr>
    <tr><td>RC.15.0100</td><td>Motilität/Stereopsis bei Kindern ≤ 7 J., beidseits</td><td>1×</td></tr>
    <tr><td>RC.25.0010</td><td>Tränenwegsondierung</td><td>–</td></tr>
    <tr><td>RC.25.0050</td><td>+ Zuschlag Tränenwegsondierung Kind ≤ 7 J.</td><td>–</td></tr>
    <tr><td>RC.35.0010</td><td>Elektroretinographie, beidseits</td><td>1×</td></tr>
    <tr><td>RC.35.0050</td><td>Fluoreszenzangiographie, pro Seite</td><td>–</td></tr>
    <tr><td>RC.35.0100</td><td>Fundusaufnahmen, einseitig</td><td>1×/Seite</td></tr>
    <tr><td><strong>RC.35.0110</strong></td><td><strong>Fundusaufnahmen, beidseits</strong></td><td>1×</td></tr>
    <tr><td>RC.35.0130</td><td>Fundus-Panorama, beidseits</td><td>1×</td></tr>
    <tr><td><strong>RC.35.0160</strong></td><td><strong>OCT vorderer Augenabschnitt, pro Seite</strong></td><td>2×, 1×/Seite</td></tr>
    <tr><td><strong>RC.35.0170</strong></td><td><strong>OCT/Schnittbild hinterer Augenabschnitt, pro Seite</strong></td><td>2×, 1×/Seite</td></tr>
    <tr><td><strong>RC.35.0190</strong></td><td><strong>OCT-Angiografie, pro Seite</strong></td><td>–</td></tr>
    <tr><td>RC.35.0210</td><td>Konfokale Mikroskopie (z.B. HRT), pro Seite</td><td>2×, 1×/Seite</td></tr>
    <tr><td>RC.40.0020</td><td>Spaltlampe vordere Abschnitte, beidseits</td><td>1×</td></tr>
    <tr><td>RC.40.0030</td><td>+ Kleineingriff an Spaltlampe, pro Auge</td><td>–</td></tr>
    <tr><td>RC.45.*</td><td>Therapeutische Diverses (z.B. Laser)</td><td>je nach Untertyp</td></tr>
    <tr><td>RC.50.*</td><td>Lidchirurgie</td><td>je nach Untertyp</td></tr>
    <tr><td>RC.55.*</td><td>Hornhaut-Eingriffe</td><td>je nach Untertyp</td></tr>
    <tr><td>RC.65.*</td><td>Linsenchirurgie (Katarakt-OP siehe H.7 Pauschalen!)</td><td>je nach Untertyp</td></tr>
    <tr><td>RC.70.0010</td><td>Biomikroskopie zentraler Fundus</td><td>1×</td></tr>
    <tr><td>RC.70.0020</td><td>+ Fundusperipherie, pro Seite</td><td>2×, 1×/Seite</td></tr>
    <tr><td>RC.70.0030</td><td>+ Skleraindentation, pro Seite</td><td>–</td></tr>
  </tbody>
</table>

<p><strong>Hinweis Kataraktoperation</strong>: Wird nicht mehr via TARDOC RC.65 abgerechnet, sondern als <strong>ambulante Pauschale</strong> (Capitulum C02). Siehe Seite H.7.</p>

${SOURCES_BLOCK}`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    title: 'H.7 Ambulante Pauschalen (Capitulum C02 Auge)',
    content: `
<h2>Hintergrund</h2>
<p>Seit <strong>01.01.2026</strong> funktioniert das ambulante Gesamttarif-System zweigleisig:</p>
<ul>
  <li><strong>TARDOC 1.4</strong> – Einzelleistungstarif</li>
  <li><strong>Ambulante Pauschalen (APG) 1.1</strong> – Fallpauschalen für standardisierbare ambulante Behandlungen</li>
</ul>
<p>Bei Eingriffen, für die eine Pauschale existiert, ist die Pauschale <strong>zwingend</strong> — keine Wahlfreiheit zwischen TARDOC und Pauschale.</p>

<h2>Code-Schema für Augen-Pauschalen</h2>
<p>Format: <strong>C&lt;Capitulum&gt;.&lt;PG&gt;&lt;Subvariante&gt;</strong></p>
<ul>
  <li><strong>C</strong> = Pauschale (Trigger-Position)</li>
  <li><strong>02</strong> = Capitulum 02 = <strong>Auge</strong></li>
  <li><strong>PG</strong> = Pauschalengruppe (10, 20, 30)</li>
  <li><strong>Subvariante</strong> = Buchstabe (A = einseitig, B = beidseitig etc.)</li>
</ul>

<h2>Drei Haupt-Pauschalen-Bereiche</h2>
<p>Laut SOG decken folgende drei Bereiche <strong>90–95 %</strong> aller ophthalmologischen Behandlungen ab:</p>
<table>
  <thead><tr><th>Code-Familie</th><th>Indikation</th><th>Bekannter Code</th><th>TP / CHF</th></tr></thead>
  <tbody>
    <tr><td><strong>C02.10x</strong></td><td>Kataraktoperation (Phakoemulsifikation + IOL-Implantation)</td><td>C02.10A/B</td><td>bilateral ≈ CHF 2'355</td></tr>
    <tr><td><strong>C02.20x</strong></td><td>Intravitreale Injektion (IVI) für AMD, DMÖ, RVV</td><td>C02.20B einseitig (verifiziert)</td><td>1'501.01 TP ≈ CHF 1'380</td></tr>
    <tr><td><strong>C02.30x</strong></td><td>Glaukom-Eingriffe (Trabekulektomie, MIGS, Stent etc.)</td><td>C02.30A/B etc.</td><td>–</td></tr>
  </tbody>
</table>

<h2>Was die Pauschale enthält (Beispiel C02.20B IVI)</h2>
<ul>
  <li>Aufklärung und Vorbereitung</li>
  <li>Sterile Anlage</li>
  <li>Die Injektion selbst</li>
  <li><strong>Das Medikament</strong> (seit 01.01.2026 – Anti-VEGF wie Eylea, Lucentis, Vabysmo)</li>
  <li>Standard-Material</li>
  <li>Zeitnahe Nachkontrolle im Pauschalen-Zeitraum</li>
</ul>

<h2>Was NICHT in der Pauschale ist (zusätzlich TARDOC abrechenbar)</h2>
<ul>
  <li>Indikationsstellung <strong>vor</strong> der OP-/IVI-Serie (Erst-Konsultation + komplette Standortbestimmung)</li>
  <li>Diagnostische Verlaufskontrollen <strong>ausserhalb</strong> des Pauschalen-Fensters</li>
  <li>Komplikationsbehandlung, die nicht zur Standard-Nachkontrolle gehört</li>
  <li>Andere Eingriffe an anderen Augen-Strukturen in derselben Sitzung (wenn medizinisch separat begründbar)</li>
</ul>

<h2>Praktischer Workflow</h2>
<ol>
  <li><strong>Diagnose stellen</strong> und ICD-10-GM Primärdiagnose in die Rechnung eintragen (z.B. H25.1 für Katarakt, H35.31/32 für AMD, H40.1 für POWG)</li>
  <li><strong>Trigger-Position</strong> (z.B. C02.20B) wählen — Praxis-Software macht das via Grouper meist automatisch</li>
  <li><strong>Keine TARDOC-Einzelpositionen</strong> für die in der Pauschale enthaltenen Leistungen ergänzen</li>
  <li>Vor-/Nachkontrollen <strong>ausserhalb</strong> der Pauschale: via TARDOC RC.* normal abrechnen</li>
</ol>

<h2>Anhang: vollständige C02-Liste</h2>
<p>Der TARDOC Online Browser führt unter <code>https://www.tardoc-online.ch/de/ambulante-pauschalen</code> alle Subvarianten und genauen TP-Werte. Sobald jemand aus der Abrechnung die komplette C02-Liste extrahiert hat, bitte hier als Anhang ergänzen.</p>

<h3>Quellen</h3>
<ul>
  <li><a href="https://www.tardoc-online.ch/de/ambulante-pauschalen/rates/C02.20B-intravitreale-injektion-einseitig">C02.20B Intravitreale Injektion einseitig (TARDOC Online Browser)</a></li>
  <li><a href="https://oaat-otma.ch/gesamt-tarifsystem/vertraege-und-anhaenge">OAAT – Katalog Ambulante Pauschalen v1.1c</a></li>
  <li><a href="https://tarifeambulant.fmh.ch/ambulante-pauschalen/allgemeines.cfm">FMH – Ambulante Pauschalen Allgemeines</a></li>
  <li><a href="https://dialog.css.ch/pauschalen-in-der-ophthalmologie/">CSS Dialog – Pauschalen in der Ophthalmologie</a></li>
</ul>`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    title: 'H.8 Notfall vs. Dringlichkeit – wann was abrechnen',
    content: `
<h2>Begriffsdefinitionen nach TARDOC AA.30</h2>
<table>
  <thead><tr><th>Begriff</th><th>Tarif-Definition</th></tr></thead>
  <tbody>
    <tr><td><strong>Notfall</strong></td><td>«Störung der Vitalfunktionen ist vorhanden, anzunehmen oder nicht auszuschliessen» — unabhängig von der auslösenden Ursache. Auch: akute Krankheit/Trauma/Vergiftung kann Organschaden verursachen oder verursacht haben.</td></tr>
    <tr><td><strong>Dringlichkeit</strong></td><td>Behandlung ist <strong>innert 2 Stunden</strong> medizinisch notwendig.</td></tr>
  </tbody>
</table>

<h2>Kumulative Voraussetzungen</h2>
<p>Alle gleichzeitig erfüllt:</p>
<ol>
  <li>Medizinische Notwendigkeit (Notfall- bzw. Dringlichkeits-Kriterium)</li>
  <li>Unmittelbares Aufsuchen / sofortige Zuwendung durch den Arzt</li>
  <li>Persönlich-körperlicher Arzt-Patient-Kontakt (Ausnahme: Telemed-Notfall F/G)</li>
  <li>Entscheidung <strong>vor</strong> der Behandlung, ob Notfall/Dringlichkeit vorliegt</li>
</ol>

<h2>Was KEIN Notfall / KEINE Dringlichkeit ist</h2>
<ul>
  <li>Patient kommt einfach unangemeldet → automatisch ≠ Notfall (häufiger Irrtum!)</li>
  <li>Wartezimmer ist voll → kein Notfall</li>
  <li>Berichte, Aktenstudium → nie als Notfall abrechenbar</li>
  <li>Spezialisierte Walk-in-/Notfall-Praxen dürfen Dringlichkeits-Pauschalen NICHT abrechnen</li>
</ul>

<h2>TARDOC-Pauschalen (Kapitel AA.30)</h2>
<table>
  <thead><tr><th>Ziffer</th><th>Bezeichnung</th><th>Zeitfenster</th><th>TP</th><th>Limit</th></tr></thead>
  <tbody>
    <tr><td>AA.30.0010</td><td>Dringlichkeits-Pauschale A</td><td>Mo–Fr 7–19 h, Sa 7–12 h</td><td>24.87</td><td>max. 2×/Tag</td></tr>
    <tr><td>AA.30.0020</td><td>Dringlichkeits-Pauschale B</td><td>Mo–Fr 19–22 h, Sa 12–19 h, So 7–19 h</td><td>–</td><td>–</td></tr>
    <tr><td><strong>AA.30.0030</strong></td><td><strong>Notfall-Pauschale C</strong></td><td>Mo–Fr 7–19 h, Sa 7–12 h</td><td>41.45</td><td>max. 1×/Sitzung</td></tr>
    <tr><td>AA.30.0040</td><td>Notfall-Pauschale D</td><td>Mo–Fr 19–22 h, Sa 12–19 h, So 7–19 h</td><td>–</td><td>–</td></tr>
    <tr><td>AA.30.0050</td><td>+ 25 % Zuschlag zu D</td><td>wie D</td><td>+25 %</td><td>–</td></tr>
    <tr><td>AA.30.0060</td><td>Notfall-Pauschale E (Nacht)</td><td>Mo–Fr 22–7 h, Sa/So 19–7 h</td><td>–</td><td>–</td></tr>
    <tr><td>AA.30.0070</td><td>+ 50 % Zuschlag zu E</td><td>wie E</td><td>+50 %</td><td>–</td></tr>
    <tr><td>AA.30.0080</td><td>Telemed. Notfall F</td><td>Mo–Fr 19–22, Sa 12–19, So 7–19 h</td><td>–</td><td>–</td></tr>
    <tr><td>AA.30.0090</td><td>+ 25 % Zuschlag zu F</td><td>wie F</td><td>+25 %</td><td>–</td></tr>
    <tr><td>AA.30.0100</td><td>Telemed. Notfall G (Nacht)</td><td>Mo–Fr 22–7, Sa/So 19–7 h</td><td>–</td><td>–</td></tr>
    <tr><td>AA.30.0110</td><td>+ 50 % Zuschlag zu G</td><td>wie G</td><td>+50 %</td><td>–</td></tr>
  </tbody>
</table>

<p><strong>Kumulationsregel</strong>: Pauschalen A–G untereinander nicht kombinierbar — pro Sitzung nur eine. Die +25 %/+50 %-Zuschläge zusätzlich zur jeweiligen Hauptpauschale.</p>

<h2>Praktische Beispiele Augenarztpraxis</h2>
<table>
  <thead><tr><th>Szenario</th><th>Notfall?</th><th>Dringlich?</th><th>Abrechnung</th></tr></thead>
  <tbody>
    <tr><td>Akuter Glaukomanfall, sofort behandelt um 11:00</td><td>ja</td><td>–</td><td>AA.30.0030 (C) + Konsultation + Therapie</td></tr>
    <tr><td>Plötzliche Visusverschlechterung, V.a. Zentralarterienverschluss</td><td>ja</td><td>–</td><td>AA.30.0030 (C) + Therapie</td></tr>
    <tr><td>Hornhautfremdkörper, Patient kommt aus Werkstatt</td><td>–</td><td>ja (innert 2 h)</td><td>AA.30.0010 (A) + Konsultation + FK-Entfernung</td></tr>
    <tr><td>Bindehautrötung, Patient unangemeldet, Wartezimmer voll</td><td>nein</td><td>nein</td><td>reguläre Konsultation – KEINE Pauschale</td></tr>
    <tr><td>Patient ruft Sa 14:00 wegen Schmerzen, Telefonberatung ohne Besuch</td><td>–</td><td>ja (telemed.)</td><td>AA.30.0080 (F)</td></tr>
    <tr><td>Augennotfall um 23:00 in Praxis</td><td>ja</td><td>–</td><td>AA.30.0060 (E) + AA.30.0070 (+50 %)</td></tr>
    <tr><td>Postop. Notfall-Nachkontrolle (Endophthalmitis-V.a.) Sa morgens</td><td>ja</td><td>–</td><td>AA.30.0030 (C) + Konsultation + Therapie</td></tr>
  </tbody>
</table>

<h2>Dokumentationspflicht</h2>
<p>Bei jeder Notfall-/Dringlichkeits-Abrechnung muss in der Akte dokumentiert sein:</p>
<ul>
  <li><strong>Zeitpunkt</strong> des Erst-Kontakts (Telefon oder Patient erscheint)</li>
  <li><strong>Zeitpunkt</strong> des persönlichen Arzt-Patient-Kontakts (entscheidend für TP)</li>
  <li><strong>Klinischer Grund</strong>, der die Notfall- bzw. Dringlichkeitskategorie rechtfertigt</li>
  <li><strong>Entscheidung VOR Beginn</strong> der Behandlung (nicht «im Nachhinein eingestuft»)</li>
</ul>
<p>Versicherer-Trustcenter führen Audits über die Notfall-Quote pro Praxis. Eine Notfall-/Dringlichkeits-Quote deutlich über dem Fachdurchschnitt (&gt; 5–10 %) löst eine <strong>Wirtschaftlichkeits-Prüfung</strong> aus.</p>

${SOURCES_BLOCK}`,
  },
]

// ── Helpers ─────────────────────────────────────────────────────────────────
function ask(rl, q) {
  return new Promise(res => rl.question(q, res))
}

// ── Main ────────────────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout })

console.log('\n╔════════════════════════════════════════════════════╗')
console.log('║   TARDOC-Abrechnung & Tarife – SOP-Seeding         ║')
console.log('╚════════════════════════════════════════════════════╝\n')

const email    = await ask(rl, 'Admin E-Mail:    ')
const password = await ask(rl, 'Admin Passwort:  ')
rl.close()

console.log('\nAnmelden …')
await setPersistence(auth, inMemoryPersistence)
await signInWithEmailAndPassword(auth, email.trim(), password.trim())
console.log('✓ Angemeldet\n')

// Idempotenz: Section bereits vorhanden? → Abbruch
console.log(`Prüfe ob Section "${SECTION_TITLE}" bereits existiert …`)
const existing = await getDocs(
  query(collection(db, S_COL), where('title', '==', SECTION_TITLE))
)
if (!existing.empty) {
  console.log(`\n⚠  Section "${SECTION_TITLE}" existiert bereits (id: ${existing.docs[0].id}).`)
  console.log('   Skript abgebrochen. Falls Neuanlage gewünscht: Section vorher in der App löschen.\n')
  process.exit(0)
}
console.log('✓ Noch nicht vorhanden – wird erstellt\n')

// Bestehende Sections lesen, um die nächste freie Order-Nummer zu finden
const allSections = await getDocs(collection(db, S_COL))
const maxOrder = allSections.docs.reduce((max, d) => {
  const o = d.data().order
  return typeof o === 'number' && o > max ? o : max
}, -1)
const nextOrder = maxOrder + 1

console.log(`Lege Section "${SECTION_TITLE}" an (order=${nextOrder}, color=${SECTION_COLOR}) …`)
const secRef = await addDoc(collection(db, S_COL), {
  title:     SECTION_TITLE,
  color:     SECTION_COLOR,
  order:     nextOrder,
  createdAt: serverTimestamp(),
})
console.log(`✓ Section angelegt (id: ${secRef.id})\n`)

console.log(`Lege Subsection "${SUBSECTION}" an …`)
const ssRef = await addDoc(collection(db, SS_COL), {
  sectionId: secRef.id,
  title:     SUBSECTION,
  order:     0,
  createdAt: serverTimestamp(),
})
console.log(`✓ Subsection angelegt (id: ${ssRef.id})\n`)

console.log(`Lege ${PAGES.length} Pages an …\n`)
for (let i = 0; i < PAGES.length; i++) {
  const p = PAGES[i]
  await addDoc(collection(db, P_COL), {
    sectionId:    secRef.id,
    subsectionId: ssRef.id,
    title:        p.title,
    content:      p.content.trim(),
    order:        i,
    createdAt:    serverTimestamp(),
    updatedAt:    serverTimestamp(),
    createdBy:    'TARDOC-Seed-Skript',
    updatedBy:    'TARDOC-Seed-Skript',
    status:       'final',
    version:      '1.0',
    zustaendig:   'Praxisleitung / Abrechnung',
    gueltigAb:    new Date().toISOString().slice(0, 10),
  })
  console.log(`  [${i + 1}/${PAGES.length}] ✓ ${p.title}`)
}

console.log(`\n✅ Fertig! Section "${SECTION_TITLE}" mit ${PAGES.length} Pages erstellt.`)
console.log('   Sichtbar in der App unter SOP → ' + SECTION_TITLE + '\n')
process.exit(0)
