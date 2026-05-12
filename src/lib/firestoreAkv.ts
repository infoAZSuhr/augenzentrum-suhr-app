import {
  collection, doc, addDoc, updateDoc, setDoc, getDocs,
  query, where, orderBy, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'

export interface AkvPerson {
  name: string
  role: string
  uid?: string   // optional link to a user account
}

export interface AkvRow {
  category: string
  task: string
  assignments: Record<string, string>  // person name → 'H' | 'S' | 'SP'
  sopPageId?: string    // optional link to a SOP page
  sopPageTitle?: string // cached title for display
}

export interface AkvDocument {
  id: string
  title: string
  verantwortlich: string
  freigegebenVon: string
  version: string
  status: 'draft' | 'final'
  gueltigAb: string
  relevantFuer: string[]   // displayNames who must confirm
  persons: AkvPerson[]
  rows: AkvRow[]
  createdAt: any
  updatedAt: any
  createdBy?: string
  updatedBy?: string
  freigabeDatum?: any
}

export interface AkvConfirmation {
  id: string
  documentId: string
  username: string
  displayName: string
  confirmedAt: any
}

const DOC_COL  = 'akv_documents'
const CONF_COL = 'akv_confirmations'

export const AKV_PERSONS: AkvPerson[] = [
  { name: 'Saran',                   role: 'MPA & Admin' },
  { name: 'Hina',                    role: 'MPA' },
  { name: 'Kristina',                role: 'MPA' },
  { name: 'Venetia',                 role: 'MPA' },
  { name: 'Dimitri',                 role: 'Arzt' },
  { name: 'Lana',                    role: 'Ärztin' },
  { name: 'Christian (GL)',          role: 'GL' },
  { name: 'Christian (med. Leiter)', role: 'med. Leiter' },
  { name: 'Extern',                  role: '' },
]

export const AKV_SEED_ROWS: AkvRow[] = [
  // Patienten- und Hausarztbeziehung
  { category: 'Patienten- und Hausarztbeziehung', task: 'Lead fürs Terminmanagement (vor und nach der Arztbehandlung)', assignments: { 'Hina': 'H', 'Venetia': 'H' } },
  { category: 'Patienten- und Hausarztbeziehung', task: 'Patientenaufnahme (Identitätsprüfung, Versicherungsdaten etc.)', assignments: {} },
  { category: 'Patienten- und Hausarztbeziehung', task: 'Diagnostik', assignments: { 'Hina': 'H' } },
  { category: 'Patienten- und Hausarztbeziehung', task: 'Verwaltung der Emailadresse info@augenzentrum-suhr.ch', assignments: {} },
  { category: 'Patienten- und Hausarztbeziehung', task: 'Schnittstelle zu Haus- und anderen Ärzten', assignments: {} },
  { category: 'Patienten- und Hausarztbeziehung', task: 'Zuweisungen an Spezialisten', assignments: {} },
  { category: 'Patienten- und Hausarztbeziehung', task: 'Feedback an Hausärzte nach der Behandlung', assignments: {} },
  // Personalmanagement MPAs
  { category: 'Personalmanagement MPAs', task: 'Einsatzplan MPAs koordinieren', assignments: { 'Saran': 'H' } },
  { category: 'Personalmanagement MPAs', task: 'AKV MPAs koordinieren', assignments: { 'Christian (GL)': 'H' } },
  { category: 'Personalmanagement MPAs', task: 'MAGs MPAs koordinieren', assignments: { 'Christian (GL)': 'H' } },
  { category: 'Personalmanagement MPAs', task: 'Weiterbildungen MPAs koordinieren', assignments: { 'Christian (GL)': 'H' } },
  { category: 'Personalmanagement MPAs', task: 'Zielsetzung MPAs koordinieren', assignments: { 'Christian (GL)': 'H' } },
  // Personalmanagement Ärzte
  { category: 'Personalmanagement Ärzte', task: 'Einsatzplan Ärzte koordinieren', assignments: { 'Saran': 'H' } },
  { category: 'Personalmanagement Ärzte', task: 'AKV Ärzte koordinieren', assignments: { 'Christian (GL)': 'H', 'Christian (med. Leiter)': 'H', 'Extern': 'H' } },
  { category: 'Personalmanagement Ärzte', task: 'MAGs Ärzte koordinieren', assignments: { 'Christian (GL)': 'H', 'Christian (med. Leiter)': 'H', 'Extern': 'H' } },
  { category: 'Personalmanagement Ärzte', task: 'Weiterbildungen Ärzte koordinieren', assignments: { 'Christian (GL)': 'H', 'Christian (med. Leiter)': 'H', 'Extern': 'H' } },
  { category: 'Personalmanagement Ärzte', task: 'Zielsetzung Ärzte koordinieren', assignments: { 'Christian (GL)': 'H', 'Christian (med. Leiter)': 'H', 'Extern': 'H' } },
  // Marketing & PR
  { category: 'Marketing & PR', task: 'Marketingkommunikation (Strategie und -budget)', assignments: { 'Christian (GL)': 'H' } },
  { category: 'Marketing & PR', task: 'Corporate Design', assignments: { 'Christian (GL)': 'H' } },
  { category: 'Marketing & PR', task: 'Fachkommunikation (Ärztezeitschriften etc.)', assignments: { 'Christian (GL)': 'H' } },
  { category: 'Marketing & PR', task: 'Zielgruppen definieren (Optiker, Altersheime, Spezialisten etc.)', assignments: { 'Christian (GL)': 'H' } },
  { category: 'Marketing & PR', task: 'Website (Inhaltspflege)', assignments: { 'Saran': 'H' } },
  { category: 'Marketing & PR', task: 'Online & Social Media (LinkedIn, Instagram, Facebook)', assignments: { 'Saran': 'H' } },
  { category: 'Marketing & PR', task: 'Datenschutz-Beauftragter', assignments: { 'Christian (GL)': 'H' } },
  { category: 'Marketing & PR', task: 'Print Marketing (Flyers, Broschüren, Beschriftungen, Give aways)', assignments: {} },
  { category: 'Marketing & PR', task: 'Events (inhouse, extern)', assignments: { 'Christian (GL)': 'H' } },
  { category: 'Marketing & PR', task: 'Koordination externer Dienstleister (Webdesigner, Agenturen, Fotografen)', assignments: {} },
  // Räumlichkeiten
  { category: 'Räumlichkeiten', task: 'Empfangsbereich & Warteräume (Deko & Pflege)', assignments: {} },
  { category: 'Räumlichkeiten', task: 'Diagnostik-, Behandlungs- & OP-Räume (Deko & Pflege)', assignments: {} },
  { category: 'Räumlichkeiten', task: 'Personalbereich: Küche, Garderoben, WC, Büro (Deko & Pflege)', assignments: {} },
  { category: 'Räumlichkeiten', task: 'Koordination externen Reinigungsdienst', assignments: {} },
  { category: 'Räumlichkeiten', task: 'Entsorgung PET', assignments: {} },
  { category: 'Räumlichkeiten', task: 'Entsorgung Altglas', assignments: {} },
  { category: 'Räumlichkeiten', task: 'Entsorgung Kehricht', assignments: {} },
  { category: 'Räumlichkeiten', task: 'Entsorgung Altkarton', assignments: {} },
  { category: 'Räumlichkeiten', task: 'Entsorgung Sonderabfall (Batterien, Metall etc.)', assignments: {} },
  // IT-Infrastruktur
  { category: 'IT-Infrastruktur', task: 'Hardware, Telefon', assignments: { 'Saran': 'H' } },
  { category: 'IT-Infrastruktur', task: 'Netzwerk', assignments: { 'Extern': 'H' } },
  { category: 'IT-Infrastruktur', task: 'Apps, Software', assignments: { 'Saran': 'H' } },
  { category: 'IT-Infrastruktur', task: 'Passwörter-Management', assignments: { 'Christian (GL)': 'H' } },
  { category: 'IT-Infrastruktur', task: 'LIRIS-Management', assignments: { 'Saran': 'H' } },
  { category: 'IT-Infrastruktur', task: 'Koordination externer IT-Dienstleister', assignments: { 'Saran': 'H' } },
  // Einkauf
  { category: 'Einkauf', task: 'Med. Geräte, Verbrauchsmaterial und Medikamente: 0 – XY CHF', assignments: {} },
  { category: 'Einkauf', task: 'Med. Geräte und Verbrauchsmaterial: XY – XY CHF', assignments: {} },
  { category: 'Einkauf', task: 'Med. Geräte und Verbrauchsmaterial: > XY CHF', assignments: { 'Christian (GL)': 'H' } },
  { category: 'Einkauf', task: 'Büro- und Haushalt: 0 – XY CHF', assignments: {} },
  { category: 'Einkauf', task: 'Büro- und Haushalt: > XY CHF', assignments: { 'Christian (GL)': 'H' } },
  { category: 'Einkauf', task: 'Wareneingang', assignments: {} },
  { category: 'Einkauf', task: 'Service & Wartungen (Geräte und Maschinen)', assignments: {} },
  { category: 'Einkauf', task: 'Service & Wartungen IT-Einrichtung', assignments: {} },
  { category: 'Einkauf', task: 'Investitionen (auf Antrag)', assignments: { 'Christian (GL)': 'H' } },
]

// ── Document CRUD ─────────────────────────────────────────────────────────────

export async function getLatestAkvDocument(): Promise<AkvDocument | null> {
  const snap = await getDocs(query(collection(db, DOC_COL), orderBy('createdAt', 'desc')))
  if (snap.empty) return null
  const d = snap.docs[0]
  return { id: d.id, ...d.data() } as AkvDocument
}

export async function updateAkvDocument(
  id: string,
  data: Partial<Omit<AkvDocument, 'id' | 'createdAt'>>,
  updatedBy?: string,
): Promise<void> {
  await updateDoc(doc(db, DOC_COL, id), { ...data, updatedAt: serverTimestamp(), ...(updatedBy ? { updatedBy } : {}) })
}

export async function releaseAkvDocument(
  id: string,
  gueltigAb: string,
  version: string,
  updatedBy?: string,
): Promise<void> {
  await updateDoc(doc(db, DOC_COL, id), {
    status: 'final',
    gueltigAb,
    version,
    freigabeDatum: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(updatedBy ? { updatedBy } : {}),
  })
}

export async function seedAkvDocument(createdBy: string): Promise<AkvDocument> {
  const payload = {
    title: 'Aufgaben-Kompetenzen-Verantwortungen (AKV)',
    verantwortlich: 'D. Stolz',
    freigegebenVon: '',
    version: '1.0',
    status: 'draft' as const,
    gueltigAb: '',
    relevantFuer: [] as string[],
    persons: AKV_PERSONS,
    rows: AKV_SEED_ROWS,
    createdBy,
    updatedBy: createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  const ref = await addDoc(collection(db, DOC_COL), payload)
  return { id: ref.id, ...payload }
}

// ── Confirmations ─────────────────────────────────────────────────────────────

export async function getAkvConfirmations(documentId: string): Promise<AkvConfirmation[]> {
  const snap = await getDocs(query(collection(db, CONF_COL), where('documentId', '==', documentId)))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() } as AkvConfirmation))
    .sort((a, b) => (a.confirmedAt?.toMillis?.() ?? 0) - (b.confirmedAt?.toMillis?.() ?? 0))
}

export async function confirmAkvDocument(
  documentId: string,
  username: string,
  displayName: string,
): Promise<void> {
  const safeUser = username.replace(/[^a-zA-Z0-9]/g, '_')
  await setDoc(doc(db, CONF_COL, `${documentId}_${safeUser}`), {
    documentId, username, displayName, confirmedAt: serverTimestamp(),
  })
}

export async function clearAkvConfirmations(documentId: string): Promise<void> {
  const snap = await getDocs(query(collection(db, CONF_COL), where('documentId', '==', documentId)))
  if (snap.empty) return
  const batch = writeBatch(db)
  snap.docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
}
