import { useState } from 'react'
import { collection, getDocs, doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../lib/AuthContext'
import { Navigate } from 'react-router-dom'
import BackButton from '../components/ui/BackButton'
import {
  Download, Database, Github, Terminal, Key, Globe, BookOpen,
  ChevronDown, ChevronRight, Loader2, CheckCircle2, AlertTriangle,
  Users, Calendar, Phone, Settings, Package, Syringe, FileText,
} from 'lucide-react'
import type { RecallPatient, VerlaufEntry, Zuweisung } from '../lib/firestoreRecall'
import type { PlanungData } from '../lib/firestorePlanung'
import type { Patient, Treatment, Appointment } from '../types/ivom.types'
import type { InventoryArticle, InventoryLot, StockMovement, Order } from '../types/inventory.types'
import type { OnboardingSection, OnboardingSubsection, OnboardingPage } from '../lib/firestoreOnboarding'

// ── CSV helpers ───────────────────────────────────────────────────────────────

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function toCsvRow(obj: Record<string, unknown>, headers: string[]): string {
  return headers.map(h => escapeCsv(obj[h])).join(',')
}

function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.join(','),
    ...rows.map(r => toCsvRow(r, headers)),
  ].join('\r\n')
  const bom = '﻿' // UTF-8 BOM for Excel
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Export functions ──────────────────────────────────────────────────────────

async function exportRecallPatienten() {
  const snap = await getDocs(collection(db, 'recall_patients'))
  const rows = snap.docs.map(d => {
    const p = d.data() as RecallPatient
    return {
      id: d.id,
      arzt: p.doctor ?? '',
      pid: p.pid ?? '',
      name: p.name ?? '',
      vorname: p.vorname ?? '',
      geburtsdatum: p.gebDatum ?? '',
      letzte_konsultation: p.letzteKons ?? '',
      naechste_konsultation: p.naechsteKons ?? '',
      aufgebot_fuer: p.aufgebotFuer ?? '',
      aufgebot_erstellt: p.aufgebotErstellt ?? '',
      aufgebot_art: p.aufgebotArt ?? '',
      aufgebot_versand: p.aufgebotVersand ?? '',
      aufgebot_notiz: p.aufgebotNotiz ?? '',
      termin_fixiert: p.terminFixiert ?? '',
      patienten_status: p.patientenStatus ?? '',
      storniert: p.storniert ?? '',
      grund_stornierung: p.grundStornierung ?? '',
      nachfass_adresse: p.nachfassAdresse ?? '',
      nachfass_tel: p.nachfassTel ?? '',
      nachfass_tel_datum: p.nachfassTelDatum ?? '',
      neupatient: p.neupatient ? 'ja' : '',
      erstellt: p.erstellt ?? '',
      aktualisiert: p.aktualisiert ?? '',
    }
  })
  downloadCsv(rows, `recall_patienten_${today()}.csv`)
  return rows.length
}

async function exportRecallVerlauf() {
  const snap = await getDocs(collection(db, 'recall_patients'))
  const rows: Record<string, unknown>[] = []
  snap.docs.forEach(d => {
    const p = d.data() as RecallPatient
    const verlauf: VerlaufEntry[] = p.verlauf ?? []
    verlauf.forEach(v => {
      rows.push({
        patient_id: d.id,
        arzt: p.doctor ?? '',
        patient_vorname: p.vorname ?? '',
        patient_pid: p.pid ?? '',
        datum: v.datum ?? '',
        aktion: v.aktion ?? '',
        ergebnis: v.ergebnis ?? '',
        von: v.von ?? '',
        grund: v.grund ?? '',
      })
    })
  })
  downloadCsv(rows, `recall_verlauf_${today()}.csv`)
  return rows.length
}

async function exportRecallZuweisungen() {
  const snap = await getDocs(collection(db, 'recall_patients'))
  const rows: Record<string, unknown>[] = []
  snap.docs.forEach(d => {
    const p = d.data() as RecallPatient
    const z: Zuweisung | null | undefined = p.zuweisung
    if (!z) return
    rows.push({
      patient_id: d.id,
      arzt: p.doctor ?? '',
      patient_vorname: p.vorname ?? '',
      patient_pid: p.pid ?? '',
      typ: z.typ ?? '',
      ziel: z.ziel ?? '',
      grund: z.grund ?? '',
      datum: z.datum ?? '',
      status: z.status ?? '',
      erledigt_am: z.erledigtAm ?? '',
      bericht_erhalten: z.berichtErhalten ? 'ja' : 'nein',
      notiz: z.notiz ?? '',
      von: z.von ?? '',
    })
  })
  downloadCsv(rows, `recall_zuweisungen_${today()}.csv`)
  return rows.length
}

async function exportPlanung(): Promise<number> {
  // Load year list
  const yearSnap = await getDoc(doc(db, 'settings', 'yearList'))
  const years: number[] = yearSnap.exists() ? (yearSnap.data().years ?? []) : []
  if (!years.length) return 0

  const rows: Record<string, unknown>[] = []
  for (const year of years) {
    const snap = await getDoc(doc(db, 'planung', String(year)))
    if (!snap.exists()) continue
    const data = snap.data() as PlanungData
    const schedule = data.schedule ?? {}
    const comments = data.comments ?? {}
    for (const [person, dates] of Object.entries(schedule)) {
      for (const [date, code] of Object.entries(dates as Record<string, string>)) {
        rows.push({
          jahr: year,
          person,
          datum: date,
          code,
          kommentar: (comments as Record<string, Record<string, string>>)[person]?.[date] ?? '',
        })
      }
    }
  }
  downloadCsv(rows, `planung_${today()}.csv`)
  return rows.length
}

// ── OP exports ───────────────────────────────────────────────────────────────

async function exportOpPatienten(): Promise<number> {
  const snap = await getDocs(collection(db, 'patients'))
  const rows = snap.docs.map(d => {
    const p = d.data() as Patient
    return {
      id: d.id,
      nachname: p.lastName ?? '',
      vorname: p.firstName ?? '',
      geburtsdatum: p.dateOfBirth ?? '',
      geschlecht: p.gender ?? '',
      patientennummer: p.patientNumber ?? '',
      versicherungsnummer: p.insuranceNumber ?? '',
      versicherung: p.insuranceName ?? '',
      diagnose_od: p.diagnosisOd ?? '',
      diagnose_os: p.diagnosisOs ?? '',
      allergien: p.allergies ?? '',
      status: p.status ?? '',
      notizen: p.notes ?? '',
      erstellt: p.createdAt ?? '',
      aktualisiert: p.updatedAt ?? '',
    }
  })
  downloadCsv(rows, `op_patienten_${today()}.csv`)
  return rows.length
}

async function exportOpBehandlungen(): Promise<number> {
  const snap = await getDocs(collection(db, 'treatments'))
  const rows = snap.docs.map(d => {
    const t = d.data() as Treatment
    return {
      id: d.id,
      patient_id: t.patientId ?? '',
      datum: t.treatmentDate ?? '',
      auge: t.eyeSide ?? '',
      medikament: t.medicationName ?? '',
      medikament_id: t.medicationId ?? '',
      chargennummer: t.lotNumber ?? '',
      va_vorher: t.vaBefore ?? '',
      va_nachher: t.vaAfter ?? '',
      va_einheit: t.vaUnit ?? '',
      oct_vorher: t.octCentralThicknessBefore ?? '',
      oct_nachher: t.octCentralThicknessAfter ?? '',
      oct_befunde: t.octFindings ?? '',
      naechster_termin: t.nextAppointment ?? '',
      naechstes_intervall_wochen: t.nextIntervalWeeks ?? '',
      durchgefuehrt_von: t.performedBy ?? '',
      behandlungsstatus: t.behandlungsStatus ?? '',
      set_name: t.setName ?? '',
      notizen: t.notes ?? '',
      erstellt: t.createdAt ?? '',
    }
  })
  downloadCsv(rows, `op_behandlungen_${today()}.csv`)
  return rows.length
}

async function exportOpTermine(): Promise<number> {
  const snap = await getDocs(collection(db, 'appointments'))
  const rows = snap.docs.map(d => {
    const a = d.data() as Appointment
    return {
      id: d.id,
      patient_id: a.patientId ?? '',
      datum: a.scheduledDate ?? '',
      typ: a.appointmentType ?? '',
      auge: a.eyeSide ?? '',
      status: a.status ?? '',
      notizen: a.notes ?? '',
    }
  })
  downloadCsv(rows, `op_termine_${today()}.csv`)
  return rows.length
}

// ── Lager exports ─────────────────────────────────────────────────────────────

async function exportLagerArtikel(): Promise<number> {
  const snap = await getDocs(collection(db, 'inventory_articles'))
  const rows = snap.docs.map(d => {
    const a = d.data() as InventoryArticle
    return {
      id: d.id,
      name: a.name ?? '',
      kategorie: a.category ?? '',
      einheit: a.unit ?? '',
      mindestbestand: a.minStock ?? '',
      lieferant: a.supplier ?? '',
      gtin: a.gtin ?? '',
      ref_nr: a.refNr ?? '',
      preis_netto_chf: a.price ?? '',
      menge_pro_packung: a.quantityPerUnit ?? '',
      mengeneinheit: a.quantityUnit ?? '',
      behandlungsart: Array.isArray(a.treatmentCategory) ? a.treatmentCategory.join('; ') : (a.treatmentCategory ?? ''),
      nicht_lieferbar: a.notDeliverable ? 'ja' : '',
      nicht_lieferbar_notiz: a.notDeliverableNote ?? '',
      zur_rose_nota: a.zurRoseNota ? 'ja' : '',
      aktiv: a.isActive ? 'ja' : 'nein',
      notizen: a.notes ?? '',
    }
  })
  downloadCsv(rows, `lager_artikel_${today()}.csv`)
  return rows.length
}

async function exportLagerChargen(): Promise<number> {
  const snap = await getDocs(collection(db, 'inventory_lots'))
  const rows = snap.docs.map(d => {
    const l = d.data() as InventoryLot
    return {
      id: d.id,
      artikel_id: l.articleId ?? '',
      chargennummer: l.lotNumber ?? '',
      bestand: l.quantity ?? '',
      verfall: l.expiryDate ?? '',
      lieferdatum: l.deliveryDate ?? '',
      einkaufspreis_chf: l.purchasePrice ?? '',
      aufgebraucht: l.isDepleted ? 'ja' : 'nein',
      notizen: l.notes ?? '',
      erstellt: l.createdAt ?? '',
    }
  })
  downloadCsv(rows, `lager_chargen_${today()}.csv`)
  return rows.length
}

async function exportLagerBuchungen(): Promise<number> {
  const snap = await getDocs(collection(db, 'stock_movements'))
  const rows = snap.docs.map(d => {
    const m = d.data() as StockMovement
    return {
      id: d.id,
      artikel_id: m.articleId ?? '',
      charge_id: m.lotId ?? '',
      chargennummer: m.lotNumber ?? '',
      datum: m.movementDate ?? '',
      typ: m.movementType ?? '',
      menge: m.quantityDelta ?? '',
      grund: m.reason ?? '',
      patient: m.patientName ?? '',
      durchgefuehrt_von: m.performedBy ?? '',
      notizen: m.notes ?? '',
    }
  })
  downloadCsv(rows, `lager_buchungen_${today()}.csv`)
  return rows.length
}

async function exportLagerBestellungen(): Promise<number> {
  const snap = await getDocs(collection(db, 'orders'))
  const rows = snap.docs.map(d => {
    const o = d.data() as Order
    return {
      id: d.id,
      artikel_id: o.articleId ?? '',
      artikel_name: o.articleName ?? '',
      lieferant: o.supplier ?? '',
      bestellnummer: o.orderNumber ?? '',
      bestelldatum: o.orderDate ?? '',
      bestellmenge: o.quantityOrdered ?? '',
      erwartete_lieferung: o.expectedDelivery ?? '',
      tatsaechliche_lieferung: o.actualDelivery ?? '',
      status: o.status ?? '',
      notizen: o.notes ?? '',
    }
  })
  downloadCsv(rows, `lager_bestellungen_${today()}.csv`)
  return rows.length
}

// ── SOP exports ───────────────────────────────────────────────────────────────

async function exportSopSeiten(): Promise<number> {
  const [sectionsSnap, subsectionsSnap, pagesSnap] = await Promise.all([
    getDocs(collection(db, 'onboarding_sections')),
    getDocs(collection(db, 'onboarding_subsections')),
    getDocs(collection(db, 'onboarding_pages')),
  ])
  const sections = Object.fromEntries(
    sectionsSnap.docs.map(d => [d.id, (d.data() as OnboardingSection).title])
  )
  const subsections = Object.fromEntries(
    subsectionsSnap.docs.map(d => [d.id, (d.data() as OnboardingSubsection).title])
  )
  const rows = pagesSnap.docs.map(d => {
    const p = d.data() as OnboardingPage
    // Strip HTML tags for plain-text export
    const plainContent = p.content?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? ''
    return {
      id: d.id,
      bereich: sections[p.sectionId] ?? p.sectionId ?? '',
      unterbereich: subsections[p.subsectionId] ?? p.subsectionId ?? '',
      titel: p.title ?? '',
      status: p.status ?? 'final',
      version: p.version ?? '',
      gueltig_ab: p.gueltigAb ?? '',
      zustaendig: p.zustaendig ?? p.createdBy ?? '',
      freigabe_durch: p.freigabeDurch ?? '',
      relevant_fuer: Array.isArray(p.relevantFuer) ? p.relevantFuer.join('; ') : '',
      inhalt_text: plainContent,
      erstellt: p.createdAt ?? '',
      aktualisiert: p.updatedAt ?? '',
    }
  })
  downloadCsv(rows, `sop_seiten_${today()}.csv`)
  return rows.length
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── Collapsible section ───────────────────────────────────────────────────────

function Section({ title, icon: Icon, children, defaultOpen = false }: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <Icon className="w-5 h-5 text-primary-600 shrink-0" />
        <span className="font-semibold text-gray-800 flex-1">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="px-5 py-4 border-t border-gray-200 bg-white space-y-4">{children}</div>}
    </div>
  )
}

// ── Export button ─────────────────────────────────────────────────────────────

type ExportStatus = 'idle' | 'loading' | 'done' | 'error'

function ExportButton({ label, description, icon: Icon, onExport }: {
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  onExport: () => Promise<number>
}) {
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [count, setCount] = useState<number | null>(null)

  async function run() {
    setStatus('loading')
    try {
      const n = await onExport()
      setCount(n)
      setStatus('done')
      setTimeout(() => setStatus('idle'), 4000)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 4000)
    }
  }

  return (
    <div className="flex items-center gap-4 py-3 border-b border-gray-100 last:border-0">
      <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
        <Icon className="w-4.5 h-4.5 text-primary-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-800">{label}</div>
        <div className="text-xs text-gray-500">{description}</div>
      </div>
      <button
        onClick={run}
        disabled={status === 'loading'}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0
          disabled:opacity-50
          bg-primary-600 text-white hover:bg-primary-700"
      >
        {status === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {status === 'done'    && <CheckCircle2 className="w-3.5 h-3.5" />}
        {status === 'error'   && <AlertTriangle className="w-3.5 h-3.5" />}
        {status === 'idle'    && <Download className="w-3.5 h-3.5" />}
        {status === 'idle'    ? 'Exportieren' :
         status === 'loading' ? 'Lädt…' :
         status === 'done'    ? `${count} Zeilen` :
                                'Fehler'}
      </button>
    </div>
  )
}

// ── Doc block ─────────────────────────────────────────────────────────────────

function DocBlock({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="flex items-center gap-2">
        <div className={`flex-1 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-800 break-all ${mono ? 'font-mono text-xs' : ''}`}>
          {value}
        </div>
        <button onClick={copy} title="Kopieren"
          className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors shrink-0">
          {copied
            ? <CheckCircle2 className="w-4 h-4 text-green-500" />
            : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          }
        </button>
      </div>
    </div>
  )
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</div>
      <div className="text-sm text-gray-700 leading-relaxed">{children}</div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminSystemPage() {
  const { isAdmin, isGeschaeftsleitung } = useAuth()

  if (!isAdmin && !isGeschaeftsleitung) return <Navigate to="/" replace />

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

      {/* Header */}
      <div className="flex items-start gap-3">
        <BackButton />
        <div>
          <h1 className="text-xl font-bold text-gray-900">System & Administration</h1>
          <p className="text-sm text-gray-500 mt-0.5">Datensicherung, Systemzugang und Wartungsanleitung — nur sichtbar für Admin und Geschäftsleitung</p>
        </div>
      </div>

      {/* ── Export ─────────────────────────────────────────────────────────── */}
      <Section title="Datensicherung / CSV-Export" icon={Database} defaultOpen>
        <p className="text-sm text-gray-600">
          Alle Daten werden direkt aus der Firebase-Datenbank geladen und als CSV-Datei heruntergeladen.
          CSV-Dateien können in Excel, Google Sheets oder anderen Programmen geöffnet werden.
          Die Dateien enthalten ein UTF-8 BOM, sodass Sonderzeichen (ä, ö, ü) in Excel korrekt angezeigt werden.
        </p>

        <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          <ExportButton
            label="Recall-Patienten"
            description="Alle Patientenfelder: Name, Geburtsdatum, Konsultationsdaten, Aufgebot-Status, etc."
            icon={Phone}
            onExport={exportRecallPatienten}
          />
          <ExportButton
            label="Recall-Verlaufseinträge"
            description="Alle Verlaufsereignisse (Anrufe, Briefe, Notizen) mit Patientenreferenz"
            icon={BookOpen}
            onExport={exportRecallVerlauf}
          />
          <ExportButton
            label="Recall-Zuweisungen"
            description="Alle Zuweisungen (intern/extern) mit Status, Erledigungsdatum und Notizen"
            icon={Users}
            onExport={exportRecallZuweisungen}
          />
          <ExportButton
            label="Einsatzplanung"
            description="Alle Einsätze aller Jahre: Person, Datum, Code, Kommentar"
            icon={Calendar}
            onExport={exportPlanung}
          />
        </div>

        <InfoBox>
          Der Export enthält <strong>keine Passwörter oder Login-Daten</strong>. Für eine vollständige
          Firestore-Sicherung empfiehlt sich zusätzlich die{' '}
          <a href="https://console.firebase.google.com/project/azsdb-999d6/firestore" target="_blank" rel="noreferrer" className="underline font-medium">
            Firebase Console → Daten exportieren
          </a>.
        </InfoBox>
      </Section>

      {/* ── OP-Bereich ─────────────────────────────────────────────────────── */}
      <Section title="OP-Bereich (IVI / Lid / KAT)" icon={Syringe}>
        <p className="text-sm text-gray-600">
          Alle Patienten, Behandlungen und Termine aus dem OP-Modul (IVOM / intravitreale Injektionen und weitere Eingriffe).
        </p>
        <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          <ExportButton
            label="OP-Patienten"
            description="Alle Patienten: Name, Geburtsdatum, Diagnose, Allergien, Status"
            icon={Users}
            onExport={exportOpPatienten}
          />
          <ExportButton
            label="OP-Behandlungen"
            description="Alle Injektionen/Eingriffe: Datum, Auge, Medikament, Visus, OCT, nächster Termin"
            icon={Syringe}
            onExport={exportOpBehandlungen}
          />
          <ExportButton
            label="OP-Termine"
            description="Alle geplanten Termine: Datum, Typ, Status"
            icon={Calendar}
            onExport={exportOpTermine}
          />
        </div>
      </Section>

      {/* ── Lagerverwaltung ────────────────────────────────────────────────── */}
      <Section title="Lagerverwaltung" icon={Package}>
        <p className="text-sm text-gray-600">
          Alle Artikel, Chargen, Lagerbewegungen und Bestellungen aus dem Lagermodul.
        </p>
        <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          <ExportButton
            label="Artikel"
            description="Alle Lagerartikel: Name, Kategorie, Einheit, Mindestbestand, Lieferant, Preis, GTIN"
            icon={Package}
            onExport={exportLagerArtikel}
          />
          <ExportButton
            label="Chargen"
            description="Alle Chargen: Chargennummer, Bestand, Verfallsdatum, Einkaufspreis"
            icon={Database}
            onExport={exportLagerChargen}
          />
          <ExportButton
            label="Buchungen (Ein-/Ausgänge)"
            description="Alle Lagerbewegungen: Datum, Typ, Menge, Grund, Patient, Charge"
            icon={BookOpen}
            onExport={exportLagerBuchungen}
          />
          <ExportButton
            label="Bestellungen"
            description="Alle Bestellungen: Artikel, Lieferant, Datum, Menge, Status"
            icon={Download}
            onExport={exportLagerBestellungen}
          />
        </div>
      </Section>

      {/* ── SOP ────────────────────────────────────────────────────────────── */}
      <Section title="SOP (Onboarding / Standard-Prozesse)" icon={FileText}>
        <p className="text-sm text-gray-600">
          Alle SOP-Seiten inkl. Inhalt als Plaintext, Zuständigkeit, Freigabe-Status und Versionierung.
          Bilder und Formatierungen werden nicht exportiert.
        </p>
        <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          <ExportButton
            label="SOP-Seiten"
            description="Alle Seiten: Bereich, Titel, Status, Version, Inhalt (Plaintext), Zuständigkeit"
            icon={FileText}
            onExport={exportSopSeiten}
          />
        </div>
      </Section>

      {/* ── Firebase ───────────────────────────────────────────────────────── */}
      <Section title="Firebase-Zugang (Datenbank & Hosting)" icon={Database}>
        <p className="text-sm text-gray-600">
          Die Applikation läuft vollständig auf <strong>Google Firebase</strong>. Dort sind gespeichert:
          alle Patientendaten (Firestore), alle Benutzerkonten (Authentication) und der Website-Code (Hosting).
        </p>

        <DocBlock label="Firebase-Projektname" value="azsdb-999d6" />
        <DocBlock label="Firebase Console (Browser)" value="https://console.firebase.google.com/project/azsdb-999d6" />
        <DocBlock label="Website-URL" value="https://azsdb-999d6.web.app" />

        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Zugang zur Firebase Console</div>
          <div className="space-y-2">
            <Step n={1}>Im Browser öffnen: <span className="font-mono text-xs bg-gray-100 px-1 rounded">console.firebase.google.com</span></Step>
            <Step n={2}>Mit dem Google-Konto anmelden, das als Projektinhaber hinterlegt ist (info@augenzentrum-suhr.ch)</Step>
            <Step n={3}>Projekt «azsdb-999d6» auswählen</Step>
            <Step n={4}><strong>Firestore Database</strong> → Daten einsehen, exportieren oder löschen</Step>
            <Step n={4}><strong>Authentication</strong> → Benutzerkonten verwalten (als Fallback zur Benutzerverwaltung in der App)</Step>
            <Step n={4}><strong>Hosting</strong> → bisherige Deployments und aktive Version einsehen</Step>
          </div>
        </div>

        <InfoBox>
          Wer Zugang zur Firebase Console verliert, kann über die Google-Kontoverwaltung ein weiteres Konto
          als Eigentümer hinzufügen — solange man noch angemeldet ist.
          Dies sollte <strong>präventiv</strong> erledigt werden (Einstellungen → Benutzer und Berechtigungen).
        </InfoBox>
      </Section>

      {/* ── GitHub ─────────────────────────────────────────────────────────── */}
      <Section title="GitHub-Repository (Quellcode)" icon={Github}>
        <p className="text-sm text-gray-600">
          Der gesamte Quellcode der Applikation ist auf GitHub gespeichert.
          Ohne Zugang zum Repository kann der Code nicht geändert oder eine neue Version deployed werden.
        </p>

        <DocBlock label="Repository-URL" value="https://github.com/infoazsuhr/augenzentrum-suhr-app" />
        <DocBlock label="GitHub-Konto" value="infoazsuhr" />
        <DocBlock label="Haupt-Branch" value="main" />

        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Zugang übertragen</div>
          <div className="space-y-2">
            <Step n={1}>Auf GitHub anmelden mit dem Konto <strong>infoazsuhr</strong></Step>
            <Step n={2}>Repository öffnen → Settings → Collaborators → «Add people»</Step>
            <Step n={3}>Neues GitHub-Konto als <strong>Admin</strong> hinzufügen</Step>
            <Step n={4}>Optional: Eigentümerschaft des Kontos übertragen (Settings → Transfer ownership)</Step>
          </div>
        </div>

        <InfoBox>
          Das GitHub-Passwort ist <strong>nicht</strong> in der App gespeichert. Es liegt beim bisherigen Admin.
          Rechtzeitig einen Nachfolger als Collaborator eintragen.
        </InfoBox>
      </Section>

      {/* ── Lokale Entwicklung ─────────────────────────────────────────────── */}
      <Section title="Lokale Entwicklungsumgebung einrichten" icon={Terminal}>
        <p className="text-sm text-gray-600">
          Um Änderungen am Code vorzunehmen, wird eine lokale Entwicklungsumgebung benötigt.
          Einmalige Einrichtung — danach kann jede Änderung direkt deployed werden.
        </p>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Voraussetzungen installieren</div>
          <div className="space-y-2">
            <Step n={1}><strong>Node.js</strong> installieren (LTS-Version): <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="underline text-primary-600">nodejs.org</a></Step>
            <Step n={2}><strong>Git</strong> installieren: <a href="https://git-scm.com" target="_blank" rel="noreferrer" className="underline text-primary-600">git-scm.com</a></Step>
            <Step n={3}><strong>Firebase CLI</strong> installieren: Terminal öffnen und eingeben:</Step>
          </div>
        </div>

        <DocBlock label="Firebase CLI installieren" value="npm install -g firebase-tools" mono />
        <DocBlock label="Repository klonen" value="git clone https://github.com/infoazsuhr/augenzentrum-suhr-app.git" mono />
        <DocBlock label="In den Projektordner wechseln" value="cd augenzentrum-suhr-app/frontend" mono />
        <DocBlock label="Abhängigkeiten installieren" value="npm install" mono />
        <DocBlock label="Lokale Entwicklungsversion starten" value="npm run dev  →  dann http://localhost:5173 öffnen" mono />

        <InfoBox>
          Die Datei <span className="font-mono text-xs">.env</span> oder Firebase-Konfiguration ist im Repository
          enthalten (da nur öffentlich zugängliche API-Keys). Die Sicherheit wird über Firebase Security Rules
          in der Firebase Console gesteuert, nicht über den Code.
        </InfoBox>
      </Section>

      {/* ── Deployment ─────────────────────────────────────────────────────── */}
      <Section title="Neue Version deployen (veröffentlichen)" icon={Globe}>
        <p className="text-sm text-gray-600">
          Nach einer Code-Änderung muss die neue Version gebaut und auf Firebase Hosting hochgeladen werden.
          Dieser Vorgang dauert ca. 1–2 Minuten.
        </p>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Schritt für Schritt</div>
          <div className="space-y-2">
            <Step n={1}>Terminal öffnen, in den Ordner <span className="font-mono text-xs bg-gray-100 px-1 rounded">augenzentrum-suhr-app/frontend</span> wechseln</Step>
            <Step n={2}>Einmalig anmelden (beim ersten Mal):</Step>
          </div>
        </div>

        <DocBlock label="Bei Firebase anmelden (einmalig)" value="firebase login" mono />
        <DocBlock label="App bauen + deployen (ein Befehl)" value="npm run build && firebase deploy --only hosting --project azsdb-999d6" mono />

        <div className="space-y-2">
          <div className="space-y-2">
            <Step n={3}>Nach ca. 30 Sekunden erscheint «Deploy complete!»</Step>
            <Step n={4}>Die Änderung ist sofort unter <span className="font-mono text-xs bg-gray-100 px-1 rounded">https://azsdb-999d6.web.app</span> live</Step>
          </div>
        </div>

        <InfoBox>
          <strong>Rollback:</strong> Falls ein Deployment fehler produziert, in der Firebase Console unter
          Hosting → Deployment-Historie die vorherige Version mit einem Klick wiederherstellen.
        </InfoBox>
      </Section>

      {/* ── Firebase Security Rules ────────────────────────────────────────── */}
      <Section title="Zugriffsschutz (Firebase Security Rules)" icon={Key}>
        <p className="text-sm text-gray-600">
          Wer auf welche Daten zugreifen darf, wird <strong>nicht</strong> nur im App-Code, sondern auch
          serverseitig in den Firebase Security Rules festgelegt. Diese müssen bei einem Plattformwechsel
          ebenfalls übertragen werden.
        </p>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rules anzeigen und bearbeiten</div>
          <div className="space-y-2">
            <Step n={1}>Firebase Console öffnen → Firestore Database → Regeln (Tab)</Step>
            <Step n={2}>Die aktuellen Rules einsehen und exportieren (Copy-Paste in Textdatei)</Step>
            <Step n={3}>Bei Änderungen: Rules anpassen und «Veröffentlichen» klicken</Step>
          </div>
        </div>

        <InfoBox>
          Ohne korrekte Security Rules sind die Daten entweder <strong>öffentlich zugänglich</strong> oder
          komplett gesperrt. Nach einem Plattformwechsel / Neuaufbau müssen die Rules als erstes konfiguriert werden.
        </InfoBox>
      </Section>

      {/* ── Weitere Tools ──────────────────────────────────────────────────── */}
      <Section title="Weitere verwendete Dienste" icon={Settings}>
        <div className="space-y-3 text-sm text-gray-700">
          <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
            <span className="font-semibold text-gray-600">Claude AI</span>
            <span>Für KI-gestützte Funktionen (z.B. Briefgenerierung). API-Key in den App-Einstellungen (Admin → Einstellungen → Claude API Key) gespeichert. Neuer Key unter <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="underline text-primary-600">console.anthropic.com</a>.</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
            <span className="font-semibold text-gray-600">Firebase Auth</span>
            <span>Alle Benutzerkonten. Passwörter können über «Passwort zurücksetzen» in der Firebase Console oder per Email-Link zurückgesetzt werden.</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
            <span className="font-semibold text-gray-600">Firebase Hosting</span>
            <span>Statisches Web-Hosting für die App. Kostenlos im Spark-Plan für &lt;10 GB/Monat Traffic.</span>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
            <span className="font-semibold text-gray-600">Firestore DB</span>
            <span>NoSQL-Datenbank für alle Betriebsdaten. Automatische Backups konfigurierbar unter Firestore → Backups.</span>
          </div>
        </div>
      </Section>

    </div>
  )
}
