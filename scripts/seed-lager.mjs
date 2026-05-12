/**
 * seed-lager.mjs
 * Erfasst die IVOM-Medikamente als Lager-Artikel in Firestore.
 * Ausführen: node scripts/seed-lager.mjs
 *
 * Voraussetzung: Firestore-Rules für inventory_articles temporär geöffnet
 * (wird automatisch erledigt via firebase deploy --only firestore:rules)
 */
import { initializeApp } from 'firebase/app'
import { getFirestore, collection, addDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyAYRnIZJ46oEPUIZ9uRiLDbTWW0dB93vgQ",
  authDomain: "azsdb-999d6.firebaseapp.com",
  projectId: "azsdb-999d6",
  storageBucket: "azsdb-999d6.firebasestorage.app",
  messagingSenderId: "782091866487",
  appId: "1:782091866487:web:4616ff6bf7cce1e15c1172",
}

const app = initializeApp(firebaseConfig)
const db  = getFirestore(app)
const COL = 'inventory_articles'

// IVOM-Medikamente (aus firestorePatients.ts – Medikamente-Liste)
const MEDICATIONS = [
  {
    name: 'Eylea 2mg',
    category: 'Medikament',
    treatmentCategory: 'IVI',
    unit: 'Ampulle',
    quantityPerUnit: 1,
    quantityUnit: 'Ampulle',
    minStock: 5,
    isActive: true,
    notes: 'Wirkstoff: Aflibercept – Standard-Intervall: 8 Wochen',
  },
  {
    name: 'Eylea HD 8mg',
    category: 'Medikament',
    treatmentCategory: 'IVI',
    unit: 'Ampulle',
    quantityPerUnit: 1,
    quantityUnit: 'Ampulle',
    minStock: 3,
    isActive: true,
    notes: 'Wirkstoff: Aflibercept 8mg – Standard-Intervall: 16 Wochen',
  },
  {
    name: 'Lucentis 0.5mg',
    category: 'Medikament',
    treatmentCategory: 'IVI',
    unit: 'Ampulle',
    quantityPerUnit: 1,
    quantityUnit: 'Ampulle',
    minStock: 3,
    isActive: true,
    notes: 'Wirkstoff: Ranibizumab – Standard-Intervall: 4 Wochen',
  },
  {
    name: 'Beovu 6mg',
    category: 'Medikament',
    treatmentCategory: 'IVI',
    unit: 'Ampulle',
    quantityPerUnit: 1,
    quantityUnit: 'Ampulle',
    minStock: 2,
    isActive: true,
    notes: 'Wirkstoff: Brolucizumab – Standard-Intervall: 12 Wochen',
  },
  {
    name: 'Vabysmo 6mg',
    category: 'Medikament',
    treatmentCategory: 'IVI',
    unit: 'Ampulle',
    quantityPerUnit: 1,
    quantityUnit: 'Ampulle',
    minStock: 3,
    isActive: true,
    notes: 'Wirkstoff: Faricimab – Standard-Intervall: 16 Wochen',
  },
  {
    name: 'Ozurdex 0.7mg',
    category: 'Medikament',
    treatmentCategory: 'IVI',
    unit: 'Ampulle',
    quantityPerUnit: 1,
    quantityUnit: 'Ampulle',
    minStock: 2,
    isActive: true,
    notes: 'Wirkstoff: Dexamethason (Implantat) – Standard-Intervall: 24 Wochen',
  },
  {
    name: 'Iluvien 190µg',
    category: 'Medikament',
    treatmentCategory: 'IVI',
    unit: 'Ampulle',
    quantityPerUnit: 1,
    quantityUnit: 'Ampulle',
    minStock: 1,
    isActive: true,
    notes: 'Wirkstoff: Fluocinolonacetonid – permanentes Implantat',
  },
]

async function run() {
  console.log('Seeding Lager – IVOM Medikamente…\n')

  // Prüfen welche Namen schon existieren
  const existing = await getDocs(collection(db, COL))
  const existingNames = new Set(existing.docs.map(d => d.data().name))

  let added = 0, skipped = 0
  for (const med of MEDICATIONS) {
    if (existingNames.has(med.name)) {
      console.log(`  ⏭  Übersprungen (existiert): ${med.name}`)
      skipped++
      continue
    }
    await addDoc(collection(db, COL), {
      ...med,
      createdAt: serverTimestamp(),
    })
    console.log(`  ✓  Hinzugefügt: ${med.name}`)
    added++
  }

  console.log(`\nFertig! ✅  ${added} hinzugefügt, ${skipped} übersprungen.`)
  process.exit(0)
}

run().catch(err => {
  console.error('Fehler:', err.message ?? err)
  process.exit(1)
})
