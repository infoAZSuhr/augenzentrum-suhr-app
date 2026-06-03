import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  getDocs, query, where, orderBy, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'

export interface OnboardingSection {
  id: string
  title: string
  color: string
  order: number
  createdAt: any
}

export interface OnboardingSubsection {
  id: string
  sectionId: string
  title: string
  order: number
  createdAt: any
}

export interface OnboardingPage {
  id: string
  sectionId: string
  subsectionId: string
  parentPageId?: string  // set for sub-pages; undefined for top-level pages
  title: string
  content: string
  order: number
  updatedAt: any
  createdAt: any
  createdBy?: string     // "Zuständig"
  updatedBy?: string
  zustaendig?: string    // manually entered responsible person
  freigabeDurch?: string // "Freigabe" — wer hat freigegeben
  freigabeDatum?: any    // wann freigegeben
  gueltigAb?: string     // "Gültig ab" (YYYY-MM-DD, gesetzt bei Freigabe)
  status?: 'draft' | 'final' // fehlendes Feld = legacy (wie final behandelt)
  version?: string | number  // backward compat: old numeric values or new string
  relevantFuer?: string[]    // displayNames who must confirm (Schulungsnachweis)
}

const S_COL  = 'onboarding_sections'
const SS_COL = 'onboarding_subsections'
const P_COL  = 'onboarding_pages'

// ── Sections ──────────────────────────────────────────────────────────────────
export async function getSections(): Promise<OnboardingSection[]> {
  const snap = await getDocs(query(collection(db, S_COL), orderBy('order', 'asc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as OnboardingSection))
}
export async function addSection(title: string, color: string, order: number): Promise<string> {
  const ref = await addDoc(collection(db, S_COL), { title, color, order, createdAt: serverTimestamp() })
  return ref.id
}
export async function updateSection(id: string, title: string, color: string): Promise<void> {
  await updateDoc(doc(db, S_COL, id), { title, color })
}
export async function deleteSection(id: string): Promise<void> {
  const [subs, pages] = await Promise.all([
    getDocs(query(collection(db, SS_COL), where('sectionId', '==', id))),
    getDocs(query(collection(db, P_COL),  where('sectionId', '==', id))),
  ])
  const batch = writeBatch(db)
  subs.docs.forEach(d => batch.delete(d.ref))
  pages.docs.forEach(d => batch.delete(d.ref))
  batch.delete(doc(db, S_COL, id))
  await batch.commit()
}

// ── Subsections ───────────────────────────────────────────────────────────────
export async function getAllSubsections(): Promise<OnboardingSubsection[]> {
  const snap = await getDocs(query(collection(db, SS_COL), orderBy('order', 'asc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as OnboardingSubsection))
}
export async function addSubsection(sectionId: string, title: string, order: number): Promise<string> {
  const ref = await addDoc(collection(db, SS_COL), { sectionId, title, order, createdAt: serverTimestamp() })
  return ref.id
}
export async function updateSubsection(id: string, title: string): Promise<void> {
  await updateDoc(doc(db, SS_COL, id), { title })
}
export async function deleteSubsection(id: string, sectionId: string): Promise<void> {
  const pages = await getDocs(query(collection(db, P_COL), where('subsectionId', '==', id)))
  const batch = writeBatch(db)
  pages.docs.forEach(d => batch.delete(d.ref))
  batch.delete(doc(db, SS_COL, id))
  await batch.commit()
}

// ── Pages ─────────────────────────────────────────────────────────────────────
export async function getAllPages(): Promise<OnboardingPage[]> {
  const snap = await getDocs(query(collection(db, P_COL), orderBy('order', 'asc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as OnboardingPage))
}
export async function addPage(subsectionId: string, sectionId: string, title: string, order: number, createdBy?: string, parentPageId?: string): Promise<string> {
  const ref = await addDoc(collection(db, P_COL), {
    subsectionId, sectionId, title, content: '', order,
    ...(parentPageId ? { parentPageId } : {}),
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    createdBy: createdBy ?? null, updatedBy: createdBy ?? null,
    version: '1.0',
    status: 'draft',
  })
  return ref.id
}

/** Gibt eine SOP-Seite frei (setzt status auf 'final'). Nur von einer zweiten Person ausführbar.
 *
 *  Wenn die Seite VORHER schon mal freigegeben war (hat freigabeDatum),
 *  wird der bisherige Stand vor dem neuen Release archiviert — damit ist
 *  jede freigegebene Version nachvollziehbar (Versionshistorie unten in
 *  der SOP-Detail-Ansicht).
 *
 *  opts.resetViews=true löscht zusätzlich alle Schulungsnachweise dieser
 *  Seite (relevant bei Major-Update wo alle nochmal lesen + bestätigen
 *  sollen).
 */
export async function releasePage(
  id: string,
  gueltigAb?: string,
  version?: string,
  opts?: { archivedBy?: string; archiveReason?: string; resetViews?: boolean },
): Promise<void> {
  // Vorherigen final-Stand archivieren, falls die Seite schon mal released war.
  const snap = await getDoc(doc(db, P_COL, id))
  if (snap.exists()) {
    const data = snap.data() as OnboardingPage
    if (data.freigabeDatum && (data.status === 'final' || data.status === undefined)) {
      await archivePageVersion(id, data, {
        archivedBy: opts?.archivedBy,
        reason:     opts?.archiveReason ?? 'new-version-released',
      })
    }
  }
  await updateDoc(doc(db, P_COL, id), {
    status: 'final',
    freigabeDatum: serverTimestamp(),
    ...(gueltigAb ? { gueltigAb } : {}),
    ...(version   ? { version   } : {}),
  })
  if (opts?.resetViews) {
    await clearPageViews(id)
  }
}

/** Setzt eine freigegebene Seite zurück auf Entwurf und löscht alle Schulungsnachweis-Einträge. */
export async function setPageToDraft(id: string): Promise<void> {
  await updateDoc(doc(db, P_COL, id), {
    status: 'draft',
    freigabeDatum: null,
    updatedAt: serverTimestamp(),
  })
  await clearPageViews(id)
}

/** Setzt alle Seiten ohne Versionsnummer auf '1.0'. */
export async function initPageVersions(): Promise<void> {
  const snap = await getDocs(collection(db, P_COL))
  const unversioned = snap.docs.filter(d => !d.data().version)
  if (unversioned.length === 0) return
  const batch = writeBatch(db)
  unversioned.forEach(d => batch.update(d.ref, { version: '1.0' }))
  await batch.commit()
}
export async function updatePage(
  id: string,
  title: string,
  content: string,
  updatedBy?: string,
  meta?: { zustaendig?: string; freigabeDurch?: string; version?: string; gueltigAb?: string },
): Promise<void> {
  const metaFields: Record<string, any> = {}
  if (meta) {
    if (meta.zustaendig    !== undefined) metaFields.zustaendig    = meta.zustaendig
    if (meta.freigabeDurch !== undefined) metaFields.freigabeDurch = meta.freigabeDurch
    if (meta.version       !== undefined) metaFields.version       = meta.version
    if (meta.gueltigAb     !== undefined) metaFields.gueltigAb     = meta.gueltigAb
  }
  await updateDoc(doc(db, P_COL, id), {
    title, content, updatedAt: serverTimestamp(), updatedBy: updatedBy ?? null,
    ...metaFields,
  })
}
export async function deletePage(id: string): Promise<void> {
  const subPages = await getDocs(query(collection(db, P_COL), where('parentPageId', '==', id)))
  if (subPages.empty) {
    await deleteDoc(doc(db, P_COL, id))
  } else {
    const batch = writeBatch(db)
    subPages.docs.forEach(d => batch.delete(d.ref))
    batch.delete(doc(db, P_COL, id))
    await batch.commit()
  }
}

export async function reorderPages(pages: { id: string; order: number }[]): Promise<void> {
  const batch = writeBatch(db)
  pages.forEach(({ id, order }) => batch.update(doc(db, P_COL, id), { order }))
  await batch.commit()
}

// ── Page views (Schulungsnachweis) ────────────────────────────────────────────

export interface PageView {
  id: string
  pageId: string
  username: string
  displayName?: string
  viewedAt: any
}

const PV_COL = 'onboarding_views'

/** Record (or update) a confirmation for the given user. One doc per user/page. */
export async function recordPageView(pageId: string, username: string, displayName?: string): Promise<void> {
  const safeUser = username.replace(/[^a-zA-Z0-9]/g, '_')
  const docId = `${pageId}_${safeUser}`
  await setDoc(doc(db, PV_COL, docId), {
    pageId, username, viewedAt: serverTimestamp(),
    ...(displayName ? { displayName } : {}),
  })
}

/** Update metadata fields of a page (e.g. relevantFuer) without touching title/content. */
export async function updatePageMeta(
  id: string,
  data: Partial<Pick<OnboardingPage, 'relevantFuer'>>,
): Promise<void> {
  await updateDoc(doc(db, P_COL, id), { ...data, updatedAt: serverTimestamp() })
}

/** Löscht alle Schulungsnachweis-Einträge einer Seite (z.B. bei Freigabe). */
export async function clearPageViews(pageId: string): Promise<void> {
  const snap = await getDocs(query(collection(db, PV_COL), where('pageId', '==', pageId)))
  if (snap.empty) return
  const batch = writeBatch(db)
  snap.docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
}

/** Holt alle Page-IDs die der eingeloggte User bereits bestätigt hat.
 *  Für den Schulungsnachweis-Status in der SOP-Navigation. */
export async function getMyConfirmedPageIds(username: string): Promise<Set<string>> {
  if (!username) return new Set()
  const snap = await getDocs(query(collection(db, PV_COL), where('username', '==', username)))
  return new Set(snap.docs.map(d => (d.data() as any).pageId).filter(Boolean))
}

/** Fetch all viewers for a page, sorted newest first. */
export async function getPageViews(pageId: string): Promise<PageView[]> {
  const snap = await getDocs(query(collection(db, PV_COL), where('pageId', '==', pageId)))
  const views = snap.docs.map(d => ({ id: d.id, ...d.data() } as PageView))
  return views.sort((a, b) => {
    const aMs = a.viewedAt?.toMillis?.() ?? 0
    const bMs = b.viewedAt?.toMillis?.() ?? 0
    return bMs - aMs
  })
}

// ── SOP Seeding ───────────────────────────────────────────────────────────────

const SOP_SEED = [
  {
    title: 'A – Praxisorganisation & Administration', color: 'blue',
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
    title: 'B – Medizinische Abläufe', color: 'green',
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
    title: 'C – Geräte & Technik', color: 'orange',
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
    title: 'D – Hygiene & Sterilgut', color: 'teal',
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
    title: 'E – Datenschutz & Compliance', color: 'red',
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
    title: 'F – Personal & Organisation', color: 'purple',
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
    title: 'G – Material & Infrastruktur', color: 'amber',
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

export async function seedSOPStructure(createdBy?: string): Promise<void> {
  for (let si = 0; si < SOP_SEED.length; si++) {
    const s = SOP_SEED[si]
    const secRef = await addDoc(collection(db, S_COL), {
      title: s.title, color: s.color, order: si, createdAt: serverTimestamp(),
    })
    const ssRef = await addDoc(collection(db, SS_COL), {
      sectionId: secRef.id, title: s.sub, order: 0, createdAt: serverTimestamp(),
    })
    for (let pi = 0; pi < s.pages.length; pi++) {
      await addDoc(collection(db, P_COL), {
        sectionId: secRef.id, subsectionId: ssRef.id,
        title: s.pages[pi], content: '', order: pi,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        createdBy: createdBy ?? null, updatedBy: createdBy ?? null,
      })
    }
  }
}

// ── SOP-Benachrichtigungen ────────────────────────────────────────────────────
//
// Re-use der bestehenden 'taskNotifications'-Collection (siehe firestoreTasks.ts).
// Schema ist erweitert um type 'sop_relevance' + 'sop_release' und optionales
// pageId-Feld. Bell-Menü in AppShell rendert sie schon mit dem erweiterten
// Navigate-Pfad → /sop/page/{pageId}.

/** Eine SOP-Notification erstellen. Default-Modus 'sop_relevance' = User wurde
 *  als "Relevant für" hinzugefügt. 'sop_release' = neue Version freigegeben. */
export async function notifySopRelevance(
  recipientUid: string,
  pageId:       string,
  pageTitle:    string,
  assignerName: string,
  mode: 'sop_relevance' | 'sop_release' = 'sop_relevance',
): Promise<void> {
  if (!recipientUid || !pageId) return
  await addDoc(collection(db, 'taskNotifications'), {
    type:         mode,
    recipientUid,
    cardId:       '',
    boardId:      '',
    cardTitle:    pageTitle,
    boardName:    'SOP',
    assignerName,
    pageId,
    read:         false,
    createdAt:    serverTimestamp(),
  })
}

/** Bulk-Helper: an mehrere User auf einmal (z.B. nach addToRelevantFuer
 *  oder bei einem Release an alle relevantFuer). Eigene Notification an
 *  sich selbst wird übersprungen. */
export async function notifySopRelevanceBulk(
  recipientUids: string[],
  pageId:        string,
  pageTitle:     string,
  assignerName:  string,
  assignerUid:   string,
  mode:          'sop_relevance' | 'sop_release' = 'sop_relevance',
): Promise<void> {
  const targets = recipientUids.filter(uid => uid && uid !== assignerUid)
  await Promise.all(targets.map(uid => notifySopRelevance(uid, pageId, pageTitle, assignerName, mode)))
}

// ── Versionshistorie ──────────────────────────────────────────────────────────
//
// Bei jedem Re-Release einer schon mal freigegebenen SOP wird der bisherige
// Stand hier abgelegt — kompletter Snapshot inkl. Title, Content, Meta-Felder
// und relevantFuer. Lesbar via getPageVersions(pageId).

export interface PageVersion {
  id:              string        // Doc-ID = `${pageId}_${randomSuffix}`
  pageId:          string
  version:         string | number | null
  title:           string
  content:         string
  zustaendig?:     string
  freigabeDurch?:  string
  freigabeDatum?:  any            // Firestore-Timestamp des damaligen Releases
  gueltigAb?:      string
  relevantFuer?:   string[]
  snapshotAt:      any            // serverTimestamp wann archiviert
  archivedBy?:     string         // User der das Re-Release ausgelöst hat
  reason?:         string         // 'new-version-released' | 'manual-archive' | ...
}

const PVER_COL = 'onboarding_page_versions'

/** Erstellt einen Snapshot des aktuellen Page-Standes in der Versionshistorie. */
export async function archivePageVersion(
  pageId: string,
  page: OnboardingPage,
  opts?: { archivedBy?: string; reason?: string },
): Promise<string> {
  const payload: Omit<PageVersion, 'id'> = {
    pageId,
    version:        page.version ?? null,
    title:          page.title ?? '',
    content:        page.content ?? '',
    ...(page.zustaendig    ? { zustaendig:    page.zustaendig    } : {}),
    ...(page.freigabeDurch ? { freigabeDurch: page.freigabeDurch } : {}),
    ...(page.freigabeDatum ? { freigabeDatum: page.freigabeDatum } : {}),
    ...(page.gueltigAb     ? { gueltigAb:     page.gueltigAb     } : {}),
    ...(page.relevantFuer  ? { relevantFuer:  page.relevantFuer  } : {}),
    snapshotAt: serverTimestamp(),
    ...(opts?.archivedBy ? { archivedBy: opts.archivedBy } : {}),
    ...(opts?.reason     ? { reason:     opts.reason     } : {}),
  }
  const ref = await addDoc(collection(db, PVER_COL), payload as any)
  return ref.id
}

/** Liefert alle archivierten Versionen einer Seite — neueste zuerst. */
export async function getPageVersions(pageId: string): Promise<PageVersion[]> {
  const snap = await getDocs(query(collection(db, PVER_COL), where('pageId', '==', pageId)))
  const versions = snap.docs.map(d => ({ id: d.id, ...d.data() } as PageVersion))
  // Sort in JS — vermeidet Composite-Index-Bedarf
  return versions.sort((a, b) => {
    const ta = (a.snapshotAt as any)?.seconds ?? 0
    const tb = (b.snapshotAt as any)?.seconds ?? 0
    return tb - ta
  })
}

/** Holt eine einzelne archivierte Version (für Detail-Anzeige). */
export async function getPageVersion(versionId: string): Promise<PageVersion | null> {
  const snap = await getDoc(doc(db, PVER_COL, versionId))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as PageVersion
}

// ── Colors ────────────────────────────────────────────────────────────────────
export const SECTION_COLORS = [
  { id: 'purple', label: 'Violett', bg: 'bg-purple-500', light: 'bg-purple-50', text: 'text-purple-700' },
  { id: 'blue',   label: 'Blau',   bg: 'bg-blue-500',   light: 'bg-blue-50',   text: 'text-blue-700'   },
  { id: 'green',  label: 'Grün',   bg: 'bg-green-500',  light: 'bg-green-50',  text: 'text-green-700'  },
  { id: 'orange', label: 'Orange', bg: 'bg-orange-500', light: 'bg-orange-50', text: 'text-orange-700' },
  { id: 'red',    label: 'Rot',    bg: 'bg-red-500',    light: 'bg-red-50',    text: 'text-red-700'    },
  { id: 'pink',   label: 'Rosa',   bg: 'bg-pink-500',   light: 'bg-pink-50',   text: 'text-pink-700'   },
  { id: 'teal',   label: 'Türkis', bg: 'bg-teal-500',   light: 'bg-teal-50',   text: 'text-teal-700'   },
  { id: 'amber',  label: 'Gelb',   bg: 'bg-amber-500',  light: 'bg-amber-50',  text: 'text-amber-700'  },
]
export function getColor(id: string) {
  return SECTION_COLORS.find(c => c.id === id) ?? SECTION_COLORS[0]
}
