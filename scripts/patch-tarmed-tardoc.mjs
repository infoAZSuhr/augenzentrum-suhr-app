/**
 * patch-tarmed-tardoc.mjs
 * Ersetzt alle "TARMED"-Vorkommen (Titel + Inhalt) in den Onboarding-
 * Collections durch "TARDOC".
 *
 * Ausführen: node scripts/patch-tarmed-tardoc.mjs
 *
 * Voraussetzung: Firestore-Rules für die drei Onboarding-Collections
 * temporär geöffnet (wird vor dem Script erledigt).
 */
import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs, updateDoc } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyAYRnIZJ46oEPUIZ9uRiLDbTWW0dB93vgQ',
  authDomain: 'azsdb-999d6.firebaseapp.com',
  projectId: 'azsdb-999d6',
  storageBucket: 'azsdb-999d6.firebasestorage.app',
  messagingSenderId: '782091866487',
  appId: '1:782091866487:web:4616ff6bf7cce1e15c1172',
}

const app = initializeApp(firebaseConfig)
const db  = getFirestore(app)

// Alle Vorkommen von TARMED (case-insensitive) durch TARDOC ersetzen
// Die Ersetzung bewahrt die Gross-/Kleinschreibung des Musters:
//   TARMED → TARDOC   Tarmed → Tardoc   tarmed → tardoc
function replaceTarmed(text) {
  if (!text) return text
  return text.replace(/tarmed/gi, m =>
    m === m.toUpperCase() ? 'TARDOC'
    : m[0] === m[0].toUpperCase() ? 'Tardoc'
    : 'tardoc'
  )
}

async function patchCollection(colName, fields) {
  const snap = await getDocs(collection(db, colName))
  let patched = 0

  for (const docSnap of snap.docs) {
    const data = docSnap.data()
    const updates = {}

    for (const field of fields) {
      const original = data[field] ?? ''
      const replaced = replaceTarmed(original)
      if (replaced !== original) updates[field] = replaced
    }

    if (Object.keys(updates).length > 0) {
      if (fields.includes('content')) updates.updatedAt = new Date().toISOString()
      await updateDoc(docSnap.ref, updates)
      const preview = Object.entries(updates)
        .filter(([k]) => k !== 'updatedAt')
        .map(([k, v]) => `  ${k}: "${String(v).slice(0, 80).replace(/\n/g, ' ')}"`)
        .join('\n')
      console.log(`  ✓ [${colName}] ${docSnap.id}\n${preview}`)
      patched++
    }
  }

  return patched
}

async function run() {
  console.log('Onboarding TARMED → TARDOC Patch\n')

  const [a, b, c] = await Promise.all([
    patchCollection('onboarding_sections',    ['title']),
    patchCollection('onboarding_subsections', ['title']),
    patchCollection('onboarding_pages',       ['title', 'content']),
  ])

  const total = a + b + c
  if (total === 0) {
    console.log('Kein TARMED-Vorkommen gefunden.')
  } else {
    console.log(`\nFertig! ✅  ${total} Dokument(e) aktualisiert.`)
  }
  process.exit(0)
}

run().catch(err => {
  console.error('Fehler:', err.message ?? err)
  process.exit(1)
})
