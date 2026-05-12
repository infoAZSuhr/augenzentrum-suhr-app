/**
 * move-to-intervention.mjs
 * Verschiebt Onboarding-Abschnitte «Katarakt», «IVT» und «Lid»
 * unter einen neuen (oder bestehenden) Abschnitt «Intervention».
 *
 * Ausführen: node scripts/move-to-intervention.mjs
 * Nur Übersicht (kein Schreiben): node scripts/move-to-intervention.mjs --dry
 */
import { initializeApp } from 'firebase/app'
import {
  getFirestore, collection, doc,
  getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, where, writeBatch,
} from 'firebase/firestore'

const DRY = process.argv.includes('--dry')

const firebaseConfig = {
  apiKey:            'AIzaSyAYRnIZJ46oEPUIZ9uRiLDbTWW0dB93vgQ',
  authDomain:        'azsdb-999d6.firebaseapp.com',
  projectId:         'azsdb-999d6',
  storageBucket:     'azsdb-999d6.firebasestorage.app',
  messagingSenderId: '782091866487',
  appId:             '1:782091866487:web:4616ff6bf7cce1e15c1172',
}

const app = initializeApp(firebaseConfig)
const db  = getFirestore(app)

const S_COL  = 'onboarding_sections'
const SS_COL = 'onboarding_subsections'
const P_COL  = 'onboarding_pages'

// Titel-Teile, die wir unter «Intervention» verschieben wollen (case-insensitive, partial match)
const TARGETS = ['katarakt', 'ivt', 'lid']

function isTarget(title) {
  const t = title.toLowerCase()
  return TARGETS.some(k => t.includes(k))
}

async function load() {
  const [sSn, ssSn, pSn] = await Promise.all([
    getDocs(query(collection(db, S_COL),  orderBy('order', 'asc'))),
    getDocs(query(collection(db, SS_COL), orderBy('order', 'asc'))),
    getDocs(query(collection(db, P_COL),  orderBy('order', 'asc'))),
  ])
  const sections    = sSn.docs.map(d => ({ id: d.id, ...d.data() }))
  const subsections = ssSn.docs.map(d => ({ id: d.id, ...d.data() }))
  const pages       = pSn.docs.map(d => ({ id: d.id, ...d.data() }))
  return { sections, subsections, pages }
}

async function run() {
  console.log(`\n=== Onboarding → Intervention Migration${DRY ? ' (DRY RUN)' : ''} ===\n`)

  const { sections, subsections, pages } = await load()

  // ── 1. Aktuelle Struktur anzeigen ───────────────────────────────────────────
  console.log('Alle Abschnitte:')
  sections.forEach(s => {
    const subs = subsections.filter(ss => ss.sectionId === s.id)
    console.log(`  [S] ${s.title} (${s.id})`)
    subs.forEach(ss => {
      const pg = pages.filter(p => p.subsectionId === ss.id)
      console.log(`    [SS] ${ss.title} (${ss.id}) — ${pg.length} Seite(n)`)
      pg.forEach(p => console.log(`      [P] ${p.title}`))
    })
  })

  // ── 2. Ziel-Elemente suchen ─────────────────────────────────────────────────
  const targetSections    = sections.filter(s  => isTarget(s.title))
  const targetSubsections = subsections.filter(ss => isTarget(ss.title))

  if (targetSections.length === 0 && targetSubsections.length === 0) {
    console.log('\n⚠️  Keine Elemente mit Titel Katarakt / IVT / Lid gefunden.')
    process.exit(0)
  }

  console.log(`\nGefunden als Abschnitte:    ${targetSections.map(s => s.title).join(', ') || '–'}`)
  console.log(`Gefunden als Unterabschnitte: ${targetSubsections.map(ss => ss.title).join(', ') || '–'}`)

  if (DRY) {
    console.log('\n→ Kein Schreibvorgang (--dry). Skript beenden.')
    process.exit(0)
  }

  // ── 3. «Intervention»-Abschnitt finden oder erstellen ──────────────────────
  let interventionSection = sections.find(s => s.title.toLowerCase() === 'intervention')
  if (!interventionSection) {
    const maxOrder = Math.max(0, ...sections.map(s => s.order ?? 0))
    const ref = await addDoc(collection(db, S_COL), {
      title: 'Intervention',
      color: 'blue',
      order: maxOrder + 1,
      createdAt: new Date().toISOString(),
    })
    interventionSection = { id: ref.id, title: 'Intervention', color: 'blue', order: maxOrder + 1 }
    console.log(`\n✓ Abschnitt «Intervention» erstellt (${ref.id})`)
  } else {
    console.log(`\n✓ Abschnitt «Intervention» gefunden (${interventionSection.id})`)
  }

  const iSectionId = interventionSection.id

  // ── 4. Abschnitte → Unterabschnitte unter «Intervention» ───────────────────
  for (let i = 0; i < targetSections.length; i++) {
    const oldSection = targetSections[i]
    const oldSubs    = subsections.filter(ss => ss.sectionId === oldSection.id)

    console.log(`\nVerschiebe Abschnitt «${oldSection.title}» …`)

    // Neuen Unterabschnitt unter «Intervention» erstellen
    const existingSubs = subsections.filter(ss => ss.sectionId === iSectionId)
    const newOrder = Math.max(0, ...existingSubs.map(ss => ss.order ?? 0)) + 1 + i

    const newSsRef = await addDoc(collection(db, SS_COL), {
      sectionId: iSectionId,
      title:     oldSection.title,
      order:     newOrder,
      createdAt: new Date().toISOString(),
    })
    const newSsId = newSsRef.id
    console.log(`  ✓ Neuer Unterabschnitt «${oldSection.title}» (${newSsId})`)

    // Alle Seiten aus allen Sub-Unterabschnitten in den neuen Unterabschnitt verschieben
    const oldPages = pages.filter(p => p.sectionId === oldSection.id)
    let pageOrder = 0
    for (const page of oldPages) {
      await updateDoc(doc(db, P_COL, page.id), {
        sectionId:    iSectionId,
        subsectionId: newSsId,
        order:        pageOrder++,
      })
      console.log(`    ✓ Seite «${page.title}» verschoben`)
    }

    // Alte Unterabschnitte löschen
    for (const ss of oldSubs) {
      await deleteDoc(doc(db, SS_COL, ss.id))
      console.log(`  ✓ Alter Unterabschnitt «${ss.title}» gelöscht`)
    }

    // Alten Abschnitt löschen
    await deleteDoc(doc(db, S_COL, oldSection.id))
    console.log(`  ✓ Alter Abschnitt «${oldSection.title}» gelöscht`)
  }

  // ── 5. Unterabschnitte → unter «Intervention» verschieben ──────────────────
  for (const ss of targetSubsections) {
    const oldSectionId = ss.sectionId
    if (oldSectionId === iSectionId) {
      console.log(`\n⊙ Unterabschnitt «${ss.title}» ist bereits unter «Intervention» — übersprungen`)
      continue
    }

    console.log(`\nVerschiebe Unterabschnitt «${ss.title}» …`)
    await updateDoc(doc(db, SS_COL, ss.id), { sectionId: iSectionId })
    console.log(`  ✓ sectionId aktualisiert`)

    // Alle Seiten dieses Unterabschnitts aktualisieren
    const ssPages = pages.filter(p => p.subsectionId === ss.id)
    for (const page of ssPages) {
      await updateDoc(doc(db, P_COL, page.id), { sectionId: iSectionId })
      console.log(`  ✓ Seite «${page.title}» sectionId aktualisiert`)
    }
  }

  console.log('\n✅ Migration abgeschlossen!\n')
  process.exit(0)
}

run().catch(err => {
  console.error('Fehler:', err.message ?? err)
  process.exit(1)
})
