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
  patientNumber?: string
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
  // Kein "nextAppointment >= today"-Filter mehr: vergangene Termine, die
  // NICHT erfasst wurden (= kein neueres Treatment fuer denselben Patient+
  // Auge), sollen weiterhin sichtbar bleiben. pickLatestPerPatientEye filtert
  // automatisch erfasste Treatments raus (es nimmt das mit hoechstem
  // treatmentDate -> wenn ein neueres existiert, ueberschattet es das alte).
  const [snap, planDays] = await Promise.all([
    getDocs(query(col('treatments'), where('nextAppointment', '!=', null))),
    getIviDaysFromPlanung(),
  ])
  const treatments = snap.docs.map(d => fromDoc<Treatment>(d))

  // Per patient+eye: keep only the latest treatment — siehe iviPlanLogic
  const perPatientEye = pickLatestPerPatientEye(treatments)

  // Fetch patient names + allergies (only active patients)
  const patientIds = [...new Set([...perPatientEye.values()].map(t => t.patientId))]
  const patientNames = new Map<string, string>()
  const patientNumbers = new Map<string, string>()
  const patientAllergies = new Map<string, string>()
  await Promise.all(patientIds.map(async id => {
    const pSnap = await getDoc(doc(db, 'patients', id))
    if (pSnap.exists() && pSnap.data().status === 'aktiv') {
      const p = pSnap.data()
      patientNames.set(id, `${p.firstName}`)
      if (p.patientNumber) patientNumbers.set(id, p.patientNumber)
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
      patientNumber: patientNumbers.get(t.patientId),
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

// Auch exportiert: PatientDetail bucht beim BEARBEITEN einer Behandlung
// neu hinzugefuegte Verbrauchsmaterialien nach (Diff alt vs. neu).
export async function deductLot(lotId: string, articleId: string, reason: string): Promise<void> {
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

  // Automatische Lagerabnahme: weitere Verbrauchsmaterialien
  for (const m of ((data as any).extraMaterials ?? []) as { articleId?: string; lotId?: string }[]) {
    if (m.lotId && m.articleId) {
      await deductLot(m.lotId, m.articleId, 'IVOM-Behandlung (Material)')
    }
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
