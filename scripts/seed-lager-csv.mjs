/**
 * seed-lager-csv.mjs
 * Importiert die 30 Artikel aus 2025-Suhr-Inventur.csv in Firestore.
 * Ausführen: node scripts/seed-lager-csv.mjs
 *
 * Voraussetzung: Firestore-Rules für inventory_articles, inventory_lots,
 *   stock_movements temporär geöffnet (allow read, write: if true)
 */
import { initializeApp } from 'firebase/app'
import {
  getFirestore, collection, addDoc, getDocs, serverTimestamp,
} from 'firebase/firestore'

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

// Lot-Bezeichnung für Eröffnungsbestand
const LOT_TAG = 'INV-2025'
const TODAY   = '2025-12-31'   // Buchungsdatum gemäss Inventur 2025

// ─── Artikeldaten ─────────────────────────────────────────────────────────────
//
// category-Mapping:
//   "Medikamente" + Augentropfen/Augengel/Augensalbe/SDU/Gtt → "Augentropfen"
//   "Medikamente" + Tabletten / Strips / NaCl               → "Medikament"
//   "Verbrauchsmaterial" + Instrumente (SC/PD-Nummern)      → "Instrument"
//   "Verbrauchsmaterial" + Rest                             → "Verbrauchsmaterial"
//
// price = Einkaufspreis aus Purchase Cost (ohne "CHF ")
// stock = Total Stock Available (Eröffnungsbestand)
// gtin  = aus chl=-Parameter der Barcode-URL (nur wenn numerisch 8–14-stellig)
// articleNumber = aus Item-ID, wenn sinnvoll (PZN, SC*, TP01, PD01)

const ARTICLES = [
  // ── AUGENTROPFEN ────────────────────────────────────────────────────────────
  {
    name: 'Oxybuprocaine 0.4% SDU Faure',
    category: 'Augentropfen',
    unit: 'Packung',
    price: 25.20,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680515230241',
    notes: '4 x 5 Einzeldosen zu 0.4 ml',
    isActive: true,
    stock: 0,
  },
  {
    name: 'Thilorbin',
    category: 'Augentropfen',
    unit: 'Flasche',
    price: 48.50,
    minStock: 1,
    supplier: 'Lindenapotheke Suhre Park',
    articleNumber: 'PZN-10998703',
    notes: '4.0mg/ml + 0.8mg/ml, Augentropfen',
    isActive: true,
    stock: 0,
  },
  {
    name: 'Vitamin A (Blache) 5g',
    category: 'Augentropfen',
    unit: 'Tube',
    price: 13.40,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680223980247',
    notes: 'Retinoli Palmitas, Augensalbe',
    isActive: true,
    stock: 1,
  },
  {
    name: 'Brimo-Vision',
    category: 'Augentropfen',
    unit: 'Packung',
    price: 25.70,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680673120033',
    notes: '60x0.35ml (6 Beutel mit 2x5 Einzeldosen)',
    isActive: true,
    stock: 1,
  },
  {
    name: 'Floxal 3g',
    category: 'Augentropfen',
    unit: 'Tube',
    price: 13.50,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680513580157',
    notes: 'Ofloxacinum 3mg/g, Augensalbe',
    isActive: true,
    stock: 1,
  },
  {
    name: 'Timogel UD 0.1%',
    category: 'Augentropfen',
    unit: 'Packung',
    price: 16.40,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680572040012',
    notes: '1mg/g Timolum ut Timololi maleas, Augengel',
    isActive: true,
    stock: 2,
  },
  {
    name: 'Tropicamid 0.5% SDU Faure Gtt',
    category: 'Augentropfen',
    unit: 'Packung',
    price: 27.70,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680547330384',
    notes: 'Tropicamidum 5mg/ml, Augentropfen, 20 Monodosis',
    isActive: true,
    stock: 2,
  },
  {
    name: 'Tetracaine 1% SDU Faure',
    category: 'Augentropfen',
    unit: 'Packung',
    price: 28.60,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680470000255',
    notes: '4 x 5 Einzeldosen zu 0.4 ml',
    isActive: true,
    stock: 3,
  },
  {
    name: 'Cyclogyl 1%',
    category: 'Augentropfen',
    unit: 'Flasche',
    price: 28.60,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680326340795',
    notes: 'Cyclopentolati Hydrochloridum',
    isActive: true,
    stock: 3,
  },
  {
    name: 'Fluoresceine Oxybuprocaine SDU Faure',
    category: 'Augentropfen',
    unit: 'Packung',
    price: 32.80,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680547560385',
    notes: 'Fluoresceinum Natricum 0.2mg/0.4ml, Oxybuprocainum Hydrochloricum 1.6mg/0.4ml',
    isActive: true,
    stock: 3,
  },
  {
    name: 'Fluoresceine 0.5% SDU Faure Gtt',
    category: 'Augentropfen',
    unit: 'Packung',
    price: 25.20,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680469960386',
    notes: 'Fluoresceinum Natricum 2mg/0.4ml',
    isActive: true,
    stock: 3,
  },
  {
    name: 'Lacri-Vision, 90 Monodosis',
    category: 'Augentropfen',
    unit: 'Packung',
    price: 42.00,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    notes: 'Acidum Hyaluronicum 0.14mg/ml, Augengel',
    isActive: true,
    stock: 3,
  },
  {
    name: 'Lacrinorm tb 10g',
    category: 'Augentropfen',
    unit: 'Tube',
    price: 5.90,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680525940017',
    notes: 'Augengel 10g',
    isActive: true,
    stock: 4,
  },
  {
    name: 'Cyclogyl 0.5%',
    category: 'Augentropfen',
    unit: 'Flasche',
    price: 28.60,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680326340603',
    notes: 'Cyclopentolati Hydrochloridum 5mg/ml',
    isActive: true,
    stock: 4,
  },
  {
    name: 'Mydriaticum Dispersa',
    category: 'Augentropfen',
    unit: 'Flasche',
    price: 16.00,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680238550381',
    notes: 'Tropicamidum 5mg/ml',
    isActive: true,
    stock: 6,
  },

  // ── MEDIKAMENTE ─────────────────────────────────────────────────────────────
  {
    name: 'Glaupax 250mg',
    category: 'Medikament',
    unit: 'Packung',
    price: 15.35,
    minStock: 1,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680384120292',
    notes: 'Azetazomidul, 40 Tabletten',
    isActive: true,
    stock: 1,
  },
  {
    name: 'SFluoro',
    category: 'Medikament',
    unit: 'Box',
    price: 39.70,
    minStock: 1,
    supplier: 'Lindenapotheke Suhre Park',
    notes: 'Fluoresceine Sodium Ophthalmic Strips 1.0mg',
    isActive: true,
    stock: 2,
  },
  {
    name: 'NaCl 0.9%',
    category: 'Medikament',
    unit: 'Packung',
    price: 18.50,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '7680295547065',
    notes: 'Mini-Placo connect, 20x10ml',
    isActive: true,
    stock: 3,
  },

  // ── VERBRAUCHSMATERIAL ──────────────────────────────────────────────────────
  {
    name: 'Meditrade Vinyl 2000 PF Gr. M',
    category: 'Verbrauchsmaterial',
    unit: 'Box',
    price: 0.01,
    minStock: 1,
    supplier: 'Omniprax',
    gtin: '4250016400301',
    notes: 'U-Handschuhe, Puderfrei, Latexfrei',
    isActive: true,
    stock: 1,
  },
  {
    name: 'Injekt Luer Solo 5ml, 100 Stk.',
    category: 'Verbrauchsmaterial',
    unit: 'Box',
    price: 11.10,
    minStock: 1,
    supplier: 'Omniprax',
    notes: 'Spritze 5ml, 100 Stück',
    isActive: true,
    stock: 1,
  },
  {
    name: 'Meditrade Nitril NextGen Gr. XL',
    category: 'Verbrauchsmaterial',
    unit: 'Box',
    price: 26.90,
    minStock: 1,
    supplier: 'Omniprax',
    gtin: '4250016461807',
    notes: 'U-Handschuhe, Nitril',
    isActive: true,
    stock: 1,
  },
  {
    name: 'Oasis Soft Plug',
    category: 'Verbrauchsmaterial',
    unit: 'Packung',
    price: 0.01,
    minStock: 1,
    supplier: 'Domedics',
    notes: 'Tränenpunktverschluss Punctum Plug',
    isActive: true,
    stock: 2,
  },
  {
    name: 'Sempercare Nitril Gr. L',
    category: 'Verbrauchsmaterial',
    unit: 'Box',
    price: 28.00,
    minStock: 1,
    supplier: 'Omniprax',
    gtin: '9001570506832',
    notes: 'U-Handschuhe, Nitril',
    isActive: true,
    stock: 2,
  },
  {
    name: 'Vasco Nitril Light Gr. S',
    category: 'Verbrauchsmaterial',
    unit: 'Box',
    price: 26.81,
    minStock: 1,
    supplier: 'Omniprax',
    gtin: '4046963817251',
    notes: 'U-Handschuhe, Nitril, puderfrei',
    isActive: true,
    stock: 3,
  },
  {
    name: 'Bio Schirmer Strips',
    category: 'Verbrauchsmaterial',
    unit: 'Box',
    price: 45.60,
    minStock: 2,
    supplier: 'Lindenapotheke Suhre Park',
    gtin: '8906025520443',
    notes: '100 sterile Strips',
    isActive: true,
    stock: 4,
  },
  {
    name: 'iCare Tonometer Probes 600 Stk.',
    category: 'Verbrauchsmaterial',
    unit: 'Box',
    price: 744.27,
    minStock: 2,
    supplier: 'Decovista',
    articleNumber: 'TP01',
    notes: '600 Stück',
    isActive: true,
    stock: 4,
  },

  // ── INSTRUMENTE ─────────────────────────────────────────────────────────────
  {
    name: 'Punctal Dilator Sharp',
    category: 'Instrument',
    unit: 'Stück',
    price: 4.43,
    minStock: 2,
    supplier: 'Medilas',
    articleNumber: 'PD01',
    notes: 'Tränenwegsonde scharf',
    isActive: true,
    stock: 5,
  },
  {
    name: 'Epilation Forceps',
    category: 'Instrument',
    unit: 'Stück',
    price: 11.78,
    minStock: 2,
    supplier: 'Medilas',
    articleNumber: 'SC127',
    notes: 'Epilier Pinzette (Wimpern)',
    isActive: true,
    stock: 6,
  },
  {
    name: 'Bonn Forceps',
    category: 'Instrument',
    unit: 'Stück',
    price: 17.51,
    minStock: 2,
    supplier: 'Medilas',
    articleNumber: 'SC38',
    notes: 'Gewebe-Pinzette',
    isActive: true,
    stock: 8,
  },
  {
    name: 'Vannas Scissors Curved',
    category: 'Instrument',
    unit: 'Stück',
    price: 24.32,
    minStock: 2,
    supplier: 'Medilas',
    articleNumber: 'SC108',
    isActive: true,
    stock: 9,
  },
]

async function run() {
  console.log(`Seeding Lager – ${ARTICLES.length} Artikel aus 2025-Suhr-Inventur.csv\n`)

  // Bestehende Namen laden (Duplikat-Schutz)
  const existing = await getDocs(collection(db, 'inventory_articles'))
  const existingNames = new Set(existing.docs.map(d => d.data().name))

  let added = 0, skipped = 0, lots = 0

  for (const art of ARTICLES) {
    const { stock, ...articleData } = art

    if (existingNames.has(art.name)) {
      console.log(`  ⏭  Übersprungen (existiert bereits): ${art.name}`)
      skipped++
      continue
    }

    // Felder ohne Wert entfernen (undefined → Firestore-Fehler)
    const clean = Object.fromEntries(
      Object.entries(articleData).filter(([, v]) => v !== undefined),
    )

    // Artikel anlegen
    const artRef = await addDoc(collection(db, 'inventory_articles'), {
      ...clean,
      createdAt: serverTimestamp(),
    })
    console.log(`  ✓  Artikel:  ${art.name}`)
    added++

    // Eröffnungsbestand anlegen (wenn > 0)
    if (stock > 0) {
      const lotRef = await addDoc(collection(db, 'inventory_lots'), {
        articleId: artRef.id,
        lotNumber: LOT_TAG,
        quantity: stock,
        isDepleted: false,
        deliveryDate: TODAY,
        createdAt: serverTimestamp(),
      })
      await addDoc(collection(db, 'stock_movements'), {
        lotId: lotRef.id,
        articleId: artRef.id,
        movementType: 'Eingang',
        quantityDelta: stock,
        reason: 'Eröffnungsbestand Inventur 2025',
        movementDate: TODAY,
      })
      console.log(`         Lot: ${LOT_TAG}  Bestand: ${stock}`)
      lots++
    }
  }

  console.log(`\nFertig! ✅  ${added} Artikel hinzugefügt, ${lots} Lots angelegt, ${skipped} übersprungen.`)
  process.exit(0)
}

run().catch(err => {
  console.error('Fehler:', err.message ?? err)
  process.exit(1)
})
