import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, setDoc,
  query, where, orderBy, serverTimestamp
} from 'firebase/firestore'
import { db } from './firebase'
import type { Patient, Treatment, Appointment, Medication } from '../types/ivom.types'
import { loadPlanung, subscribePlanung, type PlanungData } from './firestorePlanung'

const col = (name: string) => collection(db, name)

function fromDoc<T>(snap: any): T {
  return { id: snap.id, ...snap.data() } as T
}

// ─── IVOM Schema ─────────────────────────────────────────────────────────────

const DEFAULT_SCHEMA = `<h2>MPA: Vorbereitung vor dem IVI-Termin</h2><ul><li>Patienten aufbieten, sollte er beim letzten Termin nicht bereits einen Termin bekommen hat</li><li>Ein Dossier pro Patienten ist immer zu erstellen! Dies beinhaltet:<ul><li>Einwilligungsformular</li><li>Operationsanmeldung intravitreale Injektion</li><li>Bericht/Zuweisung von der 1. Spritze (Bei Neupatienten, am besten gleich anfordern, sobald er bei uns einen Termin bekommen hat. Somit ist für uns klar, wie weitervorzugehen. Welches Mittel, wieviel, welches Auge etc.)</li></ul></li><li>Eylea 2mg oder 8mg (Bayer) und Lucentis (Novatis) Fertigspritzen bestellen</li><li>Speziell bei Eylea 8mg: Mittel ist aus Durchsteckflaschen mit Filterkanüle (rot) aufzuziehen (liegt bei) und vor dem Verabreichen zu entfernen und gelbe, 30G Kanüle ist anzubringen</li><li>Halterung für Durchsteckflasche ist im OP in der obersten Schublade</li><li>Reserve der Filterkanüle sind ebenfalls im OP zu finden</li><li>Injektions-Set (Medilas) für IVI bestellen (steril)</li><li>Verbrauchsmaterial prüfen/bestellen:<ul><li>Tetracaine 1%</li><li>Desomedin</li><li>Octanisept</li><li>Injektions-Sets</li><li>OP-Handschuhe (mit und ohne Latex, steril einzeln abgepackt, Dr. Kirr hat Grösse 8)</li><li>Normale Einweghandschuhe für Assistent</li><li>NaCl B. Braun 0.9% 500ml. (Kochsalzlösung)</li><li>1 x Spritze 10ml. ohne Nadel</li><li>Gelbe Nadeln, 30G 0.30x12mm (für die IVT)</li><li>Filterkanüle</li><li>1ml Insulin Spritze</li><li>Betadine 500ml</li><li>Je 1 Schale für Betadin und NaCl</li><li>OP-Einweg Schutzkittel (für Patient)</li><li>Hauben (für Patient)</li><li>Überziehschuhe (für Patient)</li><li>Scrub T-Shirt (für Arzt/Assistent)</li><li>Scrub Hose (für Arzt/Assistent)</li></ul></li></ul><h2>MPA: Vorbereitung im OP</h2><ul><li>Chargenblatt 3x ausdrucken (je 1x für OP, Tropf-MPA und Empfang)</li><li>Notebook (Liris und OCT muss aufgestartet und funktionieren)</li><li>Weitere IVT Terminübersicht ausdrucken</li><li>IVT-Dossier aller Patienten</li><li>Spritze mind. 30 Minuten vor dem Spritzen aus dem Kühlschrank nehmen</li><li>8mg Eylea nie liegend lagern</li><li>Patienten, die beidseits Spritzen bekommen, bekommen Mittel aus demselben Lot.</li><li>Injektions-Sets bereitlegen:<ul><li>OP-Handschuhe (steril einzeln abgepackt, Dr. Kirr hat Grösse 8)</li><li>Normale Einweghandschuhe für Assistent</li><li>NaCl B. Braun 0.9% 500ml. (Kochsalzlösung)</li><li>Spritze 10ml. ohne Nadel</li><li>Gelbe Nadeln 30G 0.30x12mm (für die IVT)</li><li>Filterkanüle (Reserve)</li><li>Betadine</li><li>Schale für Betadin und NaCl</li><li>OP-Einweg Schutzkittel</li><li>Hauben</li><li>Schuhüberzug</li><li>Entsorgungsbox für Spritze</li></ul></li><li>Abfalleimer vor und im OP mit Abfallsäcke bestücken</li><li>Disomedin bereitstellen (bei Jod-Allergie)</li><li>Octanisept bereitstellen (bei Jod-Allergie)</li></ul><h2>Patient: Ankunft</h2><ul><li>Einwilligung lesen und unterschreiben lassen, falls noch nicht geschehen</li><li>Gem. Chargenblatt Markierung setzen, welches Auge und zur Absicherung dem Patienten noch einmal fragen, wo und was jeweils er gespritzt bekommen hat.</li><li>AR mit Visus machen, unbedingt vor dem Tropfen</li><li>Amsler</li><li>Tensio</li><li>OCT-Mak Aufnahme erstellen und im Liris ablegen und nur dort, wo gespritzt wird</li></ul><h2>Patient: vor dem Spritzen</h2><ul><li>Danach Patient zum OP-Schleuse begleiten und eine Haube, Überziehkleidung und -schuhe zum Anziehen geben. Wertsachen im Spin absperren.</li><li>Neu wartet ca. 5 Patient im OP-Vorraum und erst hier mit der Tropf-Phase starten</li><li>Tropfen mit Tetracaine 1%, mind. 5-mal in 3 Minuten Takt. Nur dort tropfen, wo gespritzt wird! Sollte aus Versehen falsch getropft worden sein, Auge sofort mit Augenspülung oder NaCl Mini-Plasco ausspülen!!</li></ul><h2>Patient/Arzt: während IVT</h2><ul><li>Patient wird geholt und Timeout gemacht</li><li>Patient bekommt Spritzen</li><li>Arzt schaut OCT an und gibt nächsten Termin bekannt</li></ul><h2>Patient: Nach dem Spritzen</h2><ul><li>Der Patient wird zur Schleuse begleitet, Überziehsachen können ausgezogen werden</li><li>Sobald einer raus ist, wird der nächster reingeholt</li></ul><h2>Patient/MPA: Terminvereinbarung für nächste IVT</h2><ul><li>Am Empfang kann der Patient nächster Termin abmachen und danach die Praxis verlassen</li><li>Dafalgan darf der Patient gegen Schmerzen einnehmen, sofern gefragt wird</li></ul><h2>Referenzen</h2><ul><li>Ref: 305211 — BD Blunt Fill Needle – Filter, 18G x 1½ (1.2mm x 40mm)</li><li>Ref: 9161708V — 1ml Insulin Spritze</li></ul>`

export async function getIVOMSchema(): Promise<string> {
  const snap = await getDoc(doc(db, 'settings', 'ivom_schema'))
  if (snap.exists()) return snap.data().text as string
  return DEFAULT_SCHEMA
}

export async function updateIVOMSchema(text: string): Promise<void> {
  await setDoc(doc(db, 'settings', 'ivom_schema'), { text })
}

// ─── IVOM Settings ───────────────────────────────────────────────────────────

export interface IVOMSettings {
  iviDays: number[]  // ISO: 1=Mo, 2=Di, 3=Mi, 4=Do, 5=Fr, 6=Sa, 7=So
}

export async function getIVOMSettings(): Promise<IVOMSettings> {
  const snap = await getDoc(doc(db, 'settings', 'ivom'))
  if (snap.exists()) return snap.data() as IVOMSettings
  return { iviDays: [1, 4] } // Default: Montag + Donnerstag
}

export async function updateIVOMSettings(data: IVOMSettings): Promise<void> {
  await setDoc(doc(db, 'settings', 'ivom'), data)
}

// ─── Treatment Types ──────────────────────────────────────────────────────────

const DEFAULT_TREATMENT_TYPES = ['IVI', 'KAT', 'Lid']

export async function getTreatmentTypes(): Promise<string[]> {
  const snap = await getDocs(query(col('treatment_types'), orderBy('name')))
  if (!snap.empty) return snap.docs.map(d => d.data().name as string)
  await Promise.all(DEFAULT_TREATMENT_TYPES.map(name => addDoc(col('treatment_types'), { name })))
  return DEFAULT_TREATMENT_TYPES
}

export async function addTreatmentType(name: string): Promise<string> {
  await addDoc(col('treatment_types'), { name })
  return name
}

// ─── Doctors ─────────────────────────────────────────────────────────────────

export async function getDoctors(): Promise<{ id: string; name: string }[]> {
  const snap = await getDocs(query(col('doctors'), orderBy('name')))
  return snap.docs.map(d => fromDoc<{ id: string; name: string }>(d))
}

export async function addDoctor(name: string): Promise<{ id: string; name: string }> {
  const ref = await addDoc(col('doctors'), { name })
  return { id: ref.id, name }
}

// ─── Medications ─────────────────────────────────────────────────────────────

export async function getMedications(): Promise<Medication[]> {
  const snap = await getDocs(query(col('medications'), orderBy('name')))
  if (!snap.empty) return snap.docs.map(d => fromDoc<Medication>(d))

  const defaults: Omit<Medication, 'id'>[] = [
    { name: 'Eylea 2mg',      activeIngredient: 'Aflibercept',         standardIntervalWeeks: 8,    isActive: true },
    { name: 'Eylea HD 8mg',   activeIngredient: 'Aflibercept 8mg',     standardIntervalWeeks: 16,   isActive: true },
    { name: 'Lucentis 0.5mg', activeIngredient: 'Ranibizumab',         standardIntervalWeeks: 4,    isActive: true },
    { name: 'Beovu 6mg',      activeIngredient: 'Brolucizumab',        standardIntervalWeeks: 12,   isActive: true },
    { name: 'Vabysmo 6mg',    activeIngredient: 'Faricimab',           standardIntervalWeeks: 16,   isActive: true },
    { name: 'Ozurdex 0.7mg',  activeIngredient: 'Dexamethason',        standardIntervalWeeks: 24,   isActive: true },
    { name: 'Iluvien 190µg',  activeIngredient: 'Fluocinolonacetonid', standardIntervalWeeks: null, isActive: true },
  ]
  const refs = await Promise.all(defaults.map(m => addDoc(col('medications'), m)))
  return defaults.map((m, i) => ({ id: refs[i].id, ...m }))
}

// ─── Patients ────────────────────────────────────────────────────────────────

export async function getPatientNames(): Promise<string[]> {
  const snap = await getDocs(query(col('patients'), orderBy('firstName')))
  return snap.docs.map(d => {
    const p = d.data()
    return `${p.firstName}`.trim()
  }).filter(Boolean)
}

export async function getPatients(search?: string, status?: string): Promise<Patient[]> {
  const snap = await getDocs(query(col('patients'), orderBy('firstName')))
  let patients = snap.docs.map(d => fromDoc<Patient>(d))
  if (status) patients = patients.filter(p => p.status === status)
  if (search) {
    const s = search.toLowerCase()
    patients = patients.filter(p =>
      (p.lastName ?? '').toLowerCase().includes(s) ||
      p.firstName.toLowerCase().includes(s) ||
      (p.patientNumber || '').toLowerCase().includes(s)
    )
  }
  await Promise.all(patients.map(async (p) => {
    try {
      const tSnap = await getDocs(query(col('treatments'), where('patientId', '==', p.id)))
      const treatments = tSnap.docs.map(d => fromDoc<Treatment>(d))
      treatments.sort((a, b) => b.treatmentDate.localeCompare(a.treatmentDate))
      p.treatmentCount = treatments.length
      p.lastTreatmentDate = treatments[0]?.treatmentDate
      const today = new Date().toISOString().slice(0, 10)
      const future = treatments.filter(t => t.nextAppointment && t.nextAppointment >= today)
      future.sort((a, b) => (a.nextAppointment || '').localeCompare(b.nextAppointment || ''))
      p.nextAppointmentDate = future[0]?.nextAppointment
    } catch {
      // Keine Behandlungen oder Index fehlt – Patient trotzdem anzeigen
    }
  }))
  return patients
}

export async function getPatient(id: string): Promise<Patient> {
  const snap = await getDoc(doc(db, 'patients', id))
  if (!snap.exists()) throw new Error('Patient nicht gefunden')
  const p = fromDoc<Patient>(snap)
  const tSnap = await getDocs(query(col('treatments'), where('patientId', '==', id)))
  const treatments = tSnap.docs.map(d => fromDoc<Treatment>(d))
  treatments.sort((a, b) => b.treatmentDate.localeCompare(a.treatmentDate))
  p.treatmentCount = treatments.length
  p.lastTreatmentDate = treatments[0]?.treatmentDate
  const today = new Date().toISOString().slice(0, 10)
  const future = treatments.filter(t => t.nextAppointment && t.nextAppointment >= today)
  future.sort((a, b) => (a.nextAppointment || '').localeCompare(b.nextAppointment || ''))
  p.nextAppointmentDate = future[0]?.nextAppointment
  return p
}

export async function createPatient(data: Omit<Patient, 'id'>): Promise<Patient> {
  const ref = await addDoc(col('patients'), { ...data, createdAt: serverTimestamp() })
  return { id: ref.id, ...data }
}

export async function updatePatient(id: string, data: Partial<Patient>): Promise<void> {
  const clean: Record<string, any> = {}
  for (const [k, v] of Object.entries(data as any)) {
    if (v !== undefined) clean[k] = v
  }
  await updateDoc(doc(db, 'patients', id), { ...clean, updatedAt: serverTimestamp() })
}

export async function deletePatient(id: string): Promise<void> {
  // Erst alle Behandlungen des Patienten löschen
  const tSnap = await getDocs(query(col('treatments'), where('patientId', '==', id)))
  await Promise.all(tSnap.docs.map(d => deleteDoc(d.ref)))
  // Dann den Patienten selbst löschen
  await deleteDoc(doc(db, 'patients', id))
}

// ─── Treatments ──────────────────────────────────────────────────────────────

export interface IviDayPlanEntry {
  id: string
  name: string
  eyeSide: 'OD' | 'OS'
  medicationName: string
  medicationArticleId?: string
  setName?: string
  setArticleId?: string
  performedBy?: string
  allergies?: string
}

export interface IviDayPlan {
  date: string
  entries: IviDayPlanEntry[]
}

// Doctors whose working days define IVI days (partial lowercase name match)
// IVI-Logik (Doctor-Filter, Working-Codes, latest-per-patient-eye) ist
// in src/lib/iviPlanLogic.ts extrahiert — pure & getestet.
import { extractIviDaysFromPlans, pickLatestPerPatientEye } from './iviPlanLogic'

/** Returns all future dates where Markus Tschopp or Stefan Trachsler are working */
export async function getIviDaysFromPlanung(): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10)
  const currentYear = new Date().getFullYear()
  const plans = await Promise.all([
    loadPlanung(currentYear),
    loadPlanung(currentYear + 1),
  ])
  return extractIviDaysFromPlans(plans, today)
}

/** Real-time subscription — fires whenever planung/{year} changes */
export function subscribeIviDaysFromPlanung(cb: (days: string[]) => void): () => void {
  const today = new Date().toISOString().slice(0, 10)
  const currentYear = new Date().getFullYear()
  const plans = new Map<number, PlanungData | null>()

  function recompute() {
    cb(extractIviDaysFromPlans([...plans.values()], today))
  }

  const unsubs = [currentYear, currentYear + 1].map(year =>
    subscribePlanung(year, plan => { plans.set(year, plan); recompute() })
  )
  return () => unsubs.forEach(u => u())
}

export async function getIviDayPlan(): Promise<IviDayPlan[]> {
  const today = new Date().toISOString().slice(0, 10)
  const [snap, planDays] = await Promise.all([
    getDocs(query(col('treatments'), where('nextAppointment', '>=', today))),
    getIviDaysFromPlanung(),
  ])
  const treatments = snap.docs.map(d => fromDoc<Treatment>(d))

  // Per patient+eye: keep only the latest treatment — siehe iviPlanLogic
  const perPatientEye = pickLatestPerPatientEye(treatments)

  // Fetch patient names + allergies (only active patients)
  const patientIds = [...new Set([...perPatientEye.values()].map(t => t.patientId))]
  const patientNames = new Map<string, string>()
  const patientAllergies = new Map<string, string>()
  await Promise.all(patientIds.map(async id => {
    const pSnap = await getDoc(doc(db, 'patients', id))
    if (pSnap.exists() && pSnap.data().status === 'aktiv') {
      const p = pSnap.data()
      patientNames.set(id, `${p.firstName}`)
      if (p.allergies) patientAllergies.set(id, p.allergies)
    }
  }))

  // Group by nextAppointment date — pre-populate with all IVI days from Planung
  const byDate = new Map<string, IviDayPlanEntry[]>()
  for (const date of planDays) byDate.set(date, [])

  for (const t of perPatientEye.values()) {
    if (!t.nextAppointment || !patientNames.has(t.patientId)) continue
    if (!byDate.has(t.nextAppointment)) byDate.set(t.nextAppointment, [])
    byDate.get(t.nextAppointment)!.push({
      id: t.patientId,
      name: patientNames.get(t.patientId)!,
      eyeSide: t.eyeSide,
      medicationName: t.medicationName,
      medicationArticleId: (t as any).inventoryArticleId,
      setName: t.setName,
      setArticleId: t.setArticleId,
      performedBy: t.performedBy,
      allergies: patientAllergies.get(t.patientId),
    })
  }

  return [...byDate.entries()]
    .map(([date, entries]) => ({
      date,
      entries: entries.sort((a, b) => a.name.localeCompare(b.name, 'de')),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function getPatientTreatments(patientId: string): Promise<Treatment[]> {
  // Kein orderBy+where → in JS sortieren
  const snap = await getDocs(query(col('treatments'), where('patientId', '==', patientId)))
  return snap.docs.map(d => fromDoc<Treatment>(d)).sort((a, b) => b.treatmentDate.localeCompare(a.treatmentDate))
}

async function deductLot(lotId: string, articleId: string, reason: string): Promise<void> {
  try {
    const lotSnap = await getDoc(doc(db, 'inventory_lots', lotId))
    if (!lotSnap.exists()) return
    const newQty = Math.max(0, (lotSnap.data().quantity || 0) - 1)
    await updateDoc(doc(db, 'inventory_lots', lotId), { quantity: newQty, isDepleted: newQty <= 0 })
    await addDoc(col('stock_movements'), {
      lotId, articleId, movementType: 'Abgang', quantityDelta: -1,
      reason, movementDate: new Date().toISOString().slice(0, 10),
    })
  } catch { /* Lagerabnahme ist nicht kritisch */ }
}

export async function createTreatment(data: Omit<Treatment, 'id'>): Promise<Treatment> {
  const ref = await addDoc(col('treatments'), { ...data, createdAt: serverTimestamp() })

  // Nächsten Termin als Appointment speichern
  if (data.nextAppointment) {
    await addDoc(col('appointments'), {
      patientId: data.patientId,
      scheduledDate: data.nextAppointment,
      appointmentType: 'IVOM',
      eyeSide: data.eyeSide,
      linkedTreatmentId: ref.id,
      status: 'geplant',
      createdAt: serverTimestamp(),
    })
  }

  // Automatische Lagerabnahme: Medikament
  if ((data as any).inventoryLotId && (data as any).inventoryArticleId) {
    await deductLot((data as any).inventoryLotId, (data as any).inventoryArticleId, 'IVOM-Behandlung')
  }

  // Automatische Lagerabnahme: Set
  if ((data as any).setLotId && (data as any).setArticleId) {
    await deductLot((data as any).setLotId, (data as any).setArticleId, 'IVOM-Behandlung (Set)')
  }

  return { id: ref.id, ...data }
}

export async function updateTreatment(id: string, data: Partial<Treatment>): Promise<void> {
  const clean: Record<string, any> = {}
  for (const [k, v] of Object.entries(data as any)) {
    if (v !== undefined) clean[k] = v
  }
  await updateDoc(doc(db, 'treatments', id), { ...clean, updatedAt: serverTimestamp() })
}

export async function deleteTreatment(id: string): Promise<void> {
  await deleteDoc(doc(db, 'treatments', id))
}

// ─── Appointments ─────────────────────────────────────────────────────────────

// Grouped next-appointment dates from treatments (for Dashboard IVI card)
// Includes ALL IVI days from Planung (Tschopp/Trachsler), even with 0 patients
export async function getPlannedIviDays(): Promise<{ date: string; count: number }[]> {
  const today = new Date().toISOString().slice(0, 10)
  const [snap, planDays] = await Promise.all([
    getDocs(query(
      col('treatments'),
      where('nextAppointment', '>=', today),
      orderBy('nextAppointment')
    )),
    getIviDaysFromPlanung(),
  ])
  const treatments = snap.docs.map(d => fromDoc<Treatment>(d))

  // Group by date, keeping only the latest nextAppointment per patient+eye
  const perPatientEye = new Map<string, string>()
  for (const t of treatments) {
    if (!t.nextAppointment) continue
    const key = `${t.patientId}:${t.eyeSide}`
    const existing = perPatientEye.get(key)
    if (!existing || t.nextAppointment > existing) {
      perPatientEye.set(key, t.nextAppointment)
    }
  }

  const counts = new Map<string, number>()
  // Pre-populate all Planung IVI days with 0
  for (const date of planDays) counts.set(date, 0)
  // Add patient counts
  for (const date of perPatientEye.values()) {
    counts.set(date, (counts.get(date) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function getAllPlannedAppointments(): Promise<Appointment[]> {
  const today = new Date().toISOString().slice(0, 10)
  const snap = await getDocs(query(
    col('appointments'),
    where('scheduledDate', '>=', today),
    where('status', '==', 'geplant'),
    orderBy('scheduledDate')
  ))
  const appts = snap.docs.map(d => fromDoc<Appointment>(d))
  await Promise.all(appts.map(async (a) => {
    const pSnap = await getDoc(doc(db, 'patients', a.patientId))
    if (pSnap.exists()) {
      const p = pSnap.data()
      a.patientName = `${p.firstName}`
    }
  }))
  return appts
}

export async function getUpcomingAppointments(days = 7): Promise<Appointment[]> {
  const today = new Date().toISOString().slice(0, 10)
  const future = new Date()
  future.setDate(future.getDate() + days)
  const futureStr = future.toISOString().slice(0, 10)

  const snap = await getDocs(query(
    col('appointments'),
    where('scheduledDate', '>=', today),
    where('scheduledDate', '<=', futureStr),
    where('status', '==', 'geplant'),
    orderBy('scheduledDate')
  ))

  const appts = snap.docs.map(d => fromDoc<Appointment>(d))
  await Promise.all(appts.map(async (a) => {
    const pSnap = await getDoc(doc(db, 'patients', a.patientId))
    if (pSnap.exists()) {
      const p = pSnap.data()
      a.patientName = `${p.firstName}`
    }
  }))
  return appts
}

export async function getOverduePatients() {
  const today = new Date().toISOString().slice(0, 10)
  const snap = await getDocs(query(col('treatments'), where('nextAppointment', '<', today)))
  const treatments = snap.docs.map(d => fromDoc<Treatment>(d))

  const map = new Map<string, string>()
  for (const t of treatments) {
    if (!map.has(t.patientId) || (t.nextAppointment || '') > (map.get(t.patientId) || '')) {
      map.set(t.patientId, t.nextAppointment || '')
    }
  }

  const result = []
  for (const [patientId, nextAppointment] of map) {
    const newer = await getDocs(query(col('treatments'), where('patientId', '==', patientId), where('treatmentDate', '>', nextAppointment)))
    if (newer.empty) {
      const pSnap = await getDoc(doc(db, 'patients', patientId))
      if (pSnap.exists() && pSnap.data().status === 'aktiv') {
        const p = pSnap.data()
        result.push({ patientId, patient: `${p.firstName}`, nextAppointment })
      }
    }
  }
  return result
}
