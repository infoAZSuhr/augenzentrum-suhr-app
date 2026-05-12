/**
 * Einmaliges Seeding-Script: Erstellt die vollständige SOP-Struktur in Firestore.
 * Ausführen: node scripts/seed-sop.mjs
 * (aus dem frontend/-Verzeichnis)
 */
import { initializeApp }               from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, inMemoryPersistence, setPersistence } from 'firebase/auth'
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { createInterface }             from 'readline'

// ── Firebase config ───────────────────────────────────────────────────────────
const app  = initializeApp({
  apiKey:            'AIzaSyAYRnIZJ46oEPUIZ9uRiLDbTWW0dB93vgQ',
  authDomain:        'azsdb-999d6.firebaseapp.com',
  projectId:         'azsdb-999d6',
  storageBucket:     'azsdb-999d6.firebasestorage.app',
  messagingSenderId: '782091866487',
  appId:             '1:782091866487:web:4616ff6bf7cce1e15c1172',
})
const auth = getAuth(app)
const db   = getFirestore(app)

// ── Collection names (same as app) ───────────────────────────────────────────
const S_COL  = 'onboarding_sections'
const SS_COL = 'onboarding_subsections'
const P_COL  = 'onboarding_pages'

// ── SOP-Struktur ──────────────────────────────────────────────────────────────
const SOP = [
  {
    title: 'A – Praxisorganisation & Administration',
    color: 'blue',
    sub: 'Praxisorganisation & Administration',
    pages: [
      'A.1 Patientenaufnahme & Stammdatenverwaltung',
      'A.2 Telefontriage & Dringlichkeitsstufen',
      'A.3 Terminmanagement (inkl. Online-Buchung)',
      'A.4 Umgang mit Neupatienten',
      'A.5 Abrechnung (KVG/VVG, TARMED, Selbstzahler)',
      'A.6 Rezeptwesen & Medikamentenabgabe',
      'A.7 Überweisungen & Rückmeldungen an Zuweiser',
      'A.8 Umgang mit Beschwerden & Google-Bewertungen',
      'A.9 Recall-System (Glaukom, Diabetes, IVOM, Katarakt)',
      'A.10 Dokumentationspflichten & Aktenführung',
    ],
  },
  {
    title: 'B – Medizinische Abläufe',
    color: 'green',
    sub: 'Medizinische Abläufe',
    pages: [
      'B.1 Erstuntersuchung & Basisdiagnostik',
      'B.2 Visusprüfung & Refraktion',
      'B.3 Tonometrie (NCT, iCare, Applanation)',
      'B.4 Pachymetrie',
      'B.5 OCT (Makula, Papille, Vorderabschnitt)',
      'B.6 Fundusfotografie / Weitwinkelaufnahmen',
      'B.7 Perimetrie (falls vorhanden)',
      'B.8 Glaukomkontrollen (inkl. Intervalle & Dokumentation)',
      'B.9 IVOM-Ablauf (Anti-VEGF-Injektionen)',
      'B.10 Laserbehandlungen (YAG, SLT, Argon)',
      'B.11 Postoperative Kontrollen (Katarakt, IVOM, Laser)',
      'B.12 Notfallmanagement (Trauma, akuter Visusverlust, Schmerzen)',
      'B.13 Kontaktlinsen-Anpassung & Nachkontrolle',
      'B.14 Kindersprechstunde / Orthoptik (falls vorhanden)',
    ],
  },
  {
    title: 'C – Geräte & Technik',
    color: 'orange',
    sub: 'Geräte & Technik',
    pages: [
      'C.1 Autorefraktor',
      'C.2 Non-Contact-Tonometer / iCare',
      'C.3 Spaltlampe',
      'C.4 OCT',
      'C.5 Funduskamera',
      'C.6 Perimeter',
      'C.7 Pachymeter',
      'C.8 YAG-Laser',
      'C.9 SLT-Laser',
      'C.10 Argon-Laser',
      'C.11 Sterilgutgeräte (Autoklav, Thermodesinfektor)',
      'C.12 IT-Systeme & Datensicherung',
    ],
  },
  {
    title: 'D – Hygiene & Sterilgut',
    color: 'teal',
    sub: 'Hygiene & Sterilgut',
    pages: [
      'D.1 Händehygiene',
      'D.2 Raumhygiene (Behandlungszimmer, Wartezimmer, OP-Bereich)',
      'D.3 Gerätehygiene (Spaltlampe, Tonometer, OCT)',
      'D.4 Aufbereitung von Instrumenten',
      'D.5 Sterilgutkreislauf',
      'D.6 Abfallentsorgung (inkl. Sharps)',
      'D.7 Schutzkleidung & PSA',
      'D.8 Hygieneplan & Verantwortlichkeiten',
    ],
  },
  {
    title: 'E – Datenschutz & Compliance',
    color: 'red',
    sub: 'Datenschutz & Compliance',
    pages: [
      'E.1 Datenschutz (DSG-konform)',
      'E.2 Einwilligungen (Fotos, OCT, IVOM, Datenweitergabe)',
      'E.3 Zugriffsrechte & Passwortmanagement',
      'E.4 Archivierung & Aufbewahrungsfristen',
      'E.5 Notfallzugriff / Vertretungsregelung',
      'E.6 Umgang mit sensiblen Daten (medizinisch & administrativ)',
    ],
  },
  {
    title: 'F – Personal & Organisation',
    color: 'purple',
    sub: 'Personal & Organisation',
    pages: [
      'F.1 Einarbeitung neuer Mitarbeitender',
      'F.2 Rollen & Verantwortlichkeiten',
      'F.3 Vertretungsregelungen',
      'F.4 Interne Kommunikation',
      'F.5 Schulungen & Fortbildungen',
      'F.6 Qualitätsmanagement & jährliche SOP-Überprüfung',
    ],
  },
  {
    title: 'G – Material & Infrastruktur',
    color: 'amber',
    sub: 'Material & Infrastruktur',
    pages: [
      'G.1 Lagerhaltung & Bestellwesen',
      'G.2 Medikamentenmanagement (inkl. Kühlkette)',
      'G.3 Gerätewartung & Störungsmanagement',
      'G.4 Notfallmaterial (Checklisten)',
      'G.5 Praxisräume & Infrastruktur',
    ],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function ask(rl, q) {
  return new Promise(res => rl.question(q, res))
}

// ── Main ──────────────────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout })

console.log('\n╔══════════════════════════════════════╗')
console.log('║   SOP-Struktur Seeding              ║')
console.log('╚══════════════════════════════════════╝\n')

const email    = await ask(rl, 'Admin E-Mail: ')
const password = await ask(rl, 'Passwort:    ')
rl.close()

console.log('\nAnmelden…')
await setPersistence(auth, inMemoryPersistence)
await signInWithEmailAndPassword(auth, email.trim(), password.trim())
console.log('✓ Angemeldet\n')

const total = SOP.reduce((n, s) => n + s.pages.length, 0)
console.log(`Erstelle ${SOP.length} Abschnitte mit insgesamt ${total} Seiten…\n`)

let created = 0
for (let si = 0; si < SOP.length; si++) {
  const s = SOP[si]
  process.stdout.write(`[${si + 1}/${SOP.length}] ${s.title} … `)

  // Section
  const secRef = await addDoc(collection(db, S_COL), {
    title:     s.title,
    color:     s.color,
    order:     si,
    createdAt: serverTimestamp(),
  })

  // Subsection
  const ssRef = await addDoc(collection(db, SS_COL), {
    sectionId: secRef.id,
    title:     s.sub,
    order:     0,
    createdAt: serverTimestamp(),
  })

  // Pages
  for (let pi = 0; pi < s.pages.length; pi++) {
    await addDoc(collection(db, P_COL), {
      sectionId:    secRef.id,
      subsectionId: ssRef.id,
      title:        s.pages[pi],
      content:      '',
      order:        pi,
      createdAt:    serverTimestamp(),
      updatedAt:    serverTimestamp(),
      createdBy:    null,
      updatedBy:    null,
    })
    created++
  }

  console.log(`✓ (${s.pages.length} Seiten)`)
}

console.log(`\n✅ Fertig! ${created} Seiten in ${SOP.length} Abschnitten erstellt.`)
process.exit(0)
