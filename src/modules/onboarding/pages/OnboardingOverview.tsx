import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronRight, ChevronLeft, FileText, FolderOpen, Search, GripVertical, Users, CheckCircle2, Clock, Loader2, Download, Eye, EyeOff, History, GitCompare, ArrowRightLeft } from 'lucide-react'
import BackButton from '../../../components/ui/BackButton'
import {
  getSections, getAllSubsections, getAllPages,
  addSection, updateSection, deleteSection,
  addSubsection, updateSubsection, deleteSubsection,
  addPage, updatePage, updatePageMeta, deletePage, reorderPages, releasePage, setPageToDraft, initPageVersions,
  recordPageView, getPageViews, clearPageViews,
  getPageVersions, getPageVersion,
  notifySopRelevanceBulk,
  getMyConfirmedPageIds,
  subscribeSections, subscribeSubsections, subscribePages, subscribePageViews,
  movePage,
  SECTION_COLORS, getColor,
  type OnboardingSection, type OnboardingSubsection, type OnboardingPage, type PageView, type PageVersion,
} from '../../../lib/firestoreOnboarding'
import { diffSopContent, diffSummary, type DiffPart } from '../../../lib/sopDiff'
import { useAuth } from '../../../lib/AuthContext'
import { collection, getDocs, query as fsQuery, where } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import RichTextEditor from '../../../components/ui/RichTextEditor'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import { cn } from '../../../utils/cn'
import SOPExportPreview from '../../../components/ui/SOPExportPreview'
import { expandAbbreviations } from '../../../lib/abbreviationHelper'
import { useGlossar } from '../../../lib/GlossarContext'

type DeleteTarget =
  | { type: 'section';    item: OnboardingSection }
  | { type: 'subsection'; item: OnboardingSubsection }
  | { type: 'page';       item: OnboardingPage }

// ── Search helpers ────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

function getExcerpt(text: string, query: string, radius = 55): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, radius * 2)
  const start = Math.max(0, idx - radius)
  const end   = Math.min(text.length, idx + query.length + radius)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="bg-yellow-200 text-gray-900 not-italic rounded-sm px-0.5">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  )
}

// ── QuickInput ────────────────────────────────────────────────────────────────

function QuickInput({ placeholder, onSave, onCancel }: {
  placeholder: string
  onSave: (v: string) => void
  onCancel: () => void
}) {
  const [val, setVal] = useState('')
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <input
        autoFocus
        className="input text-xs py-0.5 flex-1"
        placeholder={placeholder}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && val.trim()) onSave(val.trim())
          if (e.key === 'Escape') onCancel()
        }}
      />
      <button onClick={() => val.trim() && onSave(val.trim())} className="p-0.5 text-green-600 hover:text-green-700"><Check className="w-3.5 h-3.5" /></button>
      <button onClick={onCancel} className="p-0.5 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

function incrementVersion(v: string | number | undefined): string {
  const n = parseFloat(String(v ?? '1.0'))
  if (isNaN(n)) return '1.0'
  return (Math.round((n + 0.1) * 10) / 10).toFixed(1)
}

function fmtTs(ts: any): string {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtDateStr(s: string | undefined): string {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}.${m}.${y}`
}

export default function OnboardingOverview() {
  const { isAdmin, isArzt, isGeschaeftsleitung, isGuest, profile } = useAuth()
  const { map: glossarMap } = useGlossar()
  const canEdit        = isAdmin || isGeschaeftsleitung  // structural changes (sidebar +/delete/drag)
  const canViewRecords = !isGuest
  const username    = profile?.username    ?? ''
  const displayName = profile?.displayName ?? ''
  // Ist der aktuelle User als Zuständig für eine Seite eingetragen?
  const isZustaendigFor = (p: OnboardingPage) =>
    !!p.zustaendig && (p.zustaendig === displayName || p.zustaendig === username)
  // Ist der aktuelle User als Freigabe-Person für eine Seite eingetragen?
  const isFreigabeFor = (p: OnboardingPage) =>
    !!p.freigabeDurch && (p.freigabeDurch === displayName || p.freigabeDurch === username)
  const qc = useQueryClient()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { pageId: urlPageId } = useParams<{ pageId: string }>()
  const navigate = useNavigate()

  const [sidebarOpen,          setSidebarOpen]          = useState(true)
  const [activePageId,         setActivePageId]         = useState<string | null>(null)
  const [showExportPreview,    setShowExportPreview]    = useState(false)
  const [previewMode,          setPreviewMode]          = useState(false)
  const [expandedSections,     setExpandedSections]     = useState<Set<string>>(new Set())
  const [expandedSubsections,  setExpandedSubsections]  = useState<Set<string>>(new Set())
  const [search,               setSearch]               = useState('')

  // Inline add states
  const [addingSection,       setAddingSection]       = useState(false)
  const [sectionColor,        setSectionColor]        = useState('purple')
  const [addingSubsectionFor, setAddingSubsectionFor] = useState<string | null>(null)
  const [addingPageFor,       setAddingPageFor]       = useState<string | null>(null)
  const [addingSubPageFor,    setAddingSubPageFor]    = useState<string | null>(null)
  const [editingSection,      setEditingSection]      = useState<OnboardingSection | null>(null)
  const [editingSubsection,   setEditingSubsection]   = useState<OnboardingSubsection | null>(null)
  const [editingPage,         setEditingPage]         = useState<OnboardingPage | null>(null)
  const [expandedPages,       setExpandedPages]       = useState<Set<string>>(new Set())

  // Page editor
  const [pageTitle,        setPageTitle]        = useState('')
  const [pageContent,      setPageContent]      = useState('')
  const [pageZustaendig,    setPageZustaendig]    = useState('')
  const [pageFreigabeDurch, setPageFreigabeDurch] = useState('')
  const [pageVersion,       setPageVersion]       = useState('')
  const [pageGueltigAb,     setPageGueltigAb]     = useState('')
  const [pageDirty,   setPageDirty]   = useState(false)
  const [pageSaving,  setPageSaving]  = useState(false)
  const [pageSaved,   setPageSaved]   = useState(false)
  const autoSaveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Refs so the auto-save callback always reads latest values
  const activePageIdRef      = useRef<string | null>(null)
  const pageTitleRef         = useRef('')
  const pageContentRef       = useRef('')
  const pageZustaendigRef    = useRef('')
  const pageFreigabeDurchRef = useRef('')
  const pageVersionRef       = useRef('')
  const pageGueltigAbRef     = useRef('')
  useEffect(() => { activePageIdRef.current      = activePageId      }, [activePageId])
  useEffect(() => { pageTitleRef.current         = pageTitle         }, [pageTitle])
  useEffect(() => { pageContentRef.current       = pageContent       }, [pageContent])
  useEffect(() => { pageZustaendigRef.current    = pageZustaendig    }, [pageZustaendig])
  useEffect(() => { pageFreigabeDurchRef.current = pageFreigabeDurch }, [pageFreigabeDurch])
  useEffect(() => { pageVersionRef.current       = pageVersion       }, [pageVersion])
  useEffect(() => { pageGueltigAbRef.current     = pageGueltigAb     }, [pageGueltigAb])

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleting,     setDeleting]     = useState(false)

  // Page drag-and-drop reorder
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null)
  const [dragOverPageId, setDragOverPageId] = useState<string | null>(null)

  // Schulungsnachweis – page confirmation tracking
  const [pageViews,        setPageViews]        = useState<PageView[]>([])
  const [showViewers,      setShowViewers]       = useState(false)
  const [viewersLoading,   setViewersLoading]   = useState(false)
  const [showRelevantFuer, setShowRelevantFuer] = useState(false)
  const [showNachweis,     setShowNachweis]     = useState(false)
  const [pageRelevantFuer, setPageRelevantFuer] = useState<string[]>([])
  // Move-Modal: welche Page wird gerade verschoben + Ziel-Auswahl
  const [movingPage, setMovingPage] = useState<OnboardingPage | null>(null)
  const [moveTargetSection,    setMoveTargetSection]    = useState<string>('')
  const [moveTargetSubsection, setMoveTargetSubsection] = useState<string>('')
  const [moveTargetParentPage, setMoveTargetParentPage] = useState<string>('') // leer = Top-Level
  const [moveSaving, setMoveSaving] = useState(false)
  // Filter "Nur für mich relevant" — blendet alle SOPs aus, in denen der
  // eingeloggte User nicht in relevantFuer steht. Status wird in localStorage
  // gespeichert damit der User die Einstellung über Sessions hinweg behält.
  const [onlyMine, setOnlyMine] = useState<boolean>(() => {
    try { return localStorage.getItem('sop-only-mine') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('sop-only-mine', onlyMine ? '1' : '0') } catch {}
  }, [onlyMine])
  // Zweiter Filter: "Nur unbestätigte" — versteckt SOPs die ich schon
  // gelesen + bestätigt habe. Nur in Kombination mit onlyMine sinnvoll
  // (UI-Logik weiter unten).
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState<boolean>(() => {
    try { return localStorage.getItem('sop-only-unconfirmed') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('sop-only-unconfirmed', onlyUnconfirmed ? '1' : '0') } catch {}
  }, [onlyUnconfirmed])

  // Set der Page-IDs die ich schon bestätigt habe — wird einmal beim Mount
  // geladen und nach handleConfirm aktualisiert (lokal optimistic).
  const [myConfirmedIds, setMyConfirmedIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!username) return
    getMyConfirmedPageIds(username).then(setMyConfirmedIds).catch(() => {})
  }, [username])

  // Versionshistorie pro Page (lazy gefetcht beim ersten Öffnen der Sektion)
  const [pageVersions,      setPageVersions]      = useState<PageVersion[]>([])
  const [versionsLoading,   setVersionsLoading]   = useState(false)
  const [showVersionen,     setShowVersionen]     = useState(false)
  // Version die im Modal angeschaut wird (null = Modal zu)
  const [openVersion,       setOpenVersion]       = useState<PageVersion | null>(null)
  // Toggle im Modal: 'snapshot' = nur die alte Version zeigen, 'diff' = Vergleich zur aktuellen
  const [versionView,       setVersionView]       = useState<'snapshot' | 'diff'>('diff')
  const [confirming,       setConfirming]       = useState(false)
  const viewersPanelRef = useRef<HTMLDivElement>(null)

  // Freigabe-Panel
  const [releasing, setReleasing] = useState(false)

  // Approved users for Zuständig / Freigabe dropdowns + Relevant-für-Gruppen
  type SopUser = { uid: string; displayName: string; role: string; additionalRoles: string[] }
  const [sopUsers, setSopUsers] = useState<SopUser[]>([])
  useEffect(() => {
    getDocs(fsQuery(collection(db, 'users'), where('status', '==', 'approved')))
      .then(snap => {
        const list: SopUser[] = snap.docs
          .map(d => {
            const u = d.data() as any
            return {
              uid:             u.uid,
              displayName:     u.displayName || u.username || '',
              role:            u.role || '',
              additionalRoles: Array.isArray(u.additionalRoles) ? u.additionalRoles : [],
            }
          })
          .filter(u => u.displayName)
          .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'))
        setSopUsers(list)
      })
      .catch(() => {})
  }, [])

  // Hat User eine bestimmte Rolle (primär ODER als additional)? Genutzt für Gruppen-Selektion.
  function userHasRole(u: SopUser, role: string): boolean {
    return u.role === role || u.additionalRoles.includes(role)
  }

  const { data: sections    = [], isLoading: sectionsLoading } = useQuery({ queryKey: ['ob-sections'],    queryFn: getSections })
  const { data: subsections = [] }                            = useQuery({ queryKey: ['ob-subsections'], queryFn: getAllSubsections })
  const { data: allPages    = [] }                            = useQuery({ queryKey: ['ob-pages'],       queryFn: getAllPages })

  // Live-Subscriptions auf die drei SOP-Collections — sobald jemand
  // (Admin, GL, anderer Editor) eine Sektion/Subsection/Page ändert, wird
  // der TanStack-Query-Cache mit dem frischen Snapshot überschrieben.
  // Vorteil ggü. polling: keine Latenz, kein wasted-bandwidth bei Inaktivität.
  useEffect(() => {
    const u1 = subscribeSections   (data => qc.setQueryData(['ob-sections'],    data))
    const u2 = subscribeSubsections(data => qc.setQueryData(['ob-subsections'], data))
    const u3 = subscribePages      (data => qc.setQueryData(['ob-pages'],       data))
    return () => { u1(); u2(); u3() }
  }, [qc])

  // Live-Schulungsnachweise für die gerade offene Page — Admin/GL sieht
  // den Counter "X / Y Bestätigungen" tickern während Mitarbeiter
  // bestätigen, ohne dass der Schulungsnachweis-Panel manuell
  // neu geladen werden muss.
  useEffect(() => {
    if (!activePageId || !canViewRecords) return
    return subscribePageViews(activePageId, setPageViews)
  }, [activePageId, canViewRecords])

  // Einmalig: alle Seiten ohne Version auf 1.0 setzen
  useEffect(() => {
    if ((!isAdmin && !isGeschaeftsleitung) || allPages.length === 0) return
    if (allPages.some(p => !p.version)) {
      initPageVersions().then(() => refresh()).catch(() => {})
    }
  }, [allPages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Navigation: ALLE Pages werden angezeigt — auch Drafts.
  // Für Drafts wird beim Öffnen statt des Inhalts ein "in Bearbeitung"-Banner
  // gezeigt (Sichtbarkeitskontrolle erfolgt im Content-Bereich, nicht hier).
  //
  // onlyMine-Filter: Page ist sichtbar wenn ICH (displayName oder username)
  // in relevantFuer stehe, ODER mein Parent-Page für mich relevant ist
  // (sonst würden Sub-Pages den Kontext verlieren). Admins/GL sehen
  // weiterhin alles — diese Rolle braucht Übersicht ohne Filter.
  const isPageForMe = (p: OnboardingPage): boolean =>
    (p.relevantFuer ?? []).some(n => n === displayName || n === username)
  const visiblePages = useMemo(() => {
    if (isAdmin || isGeschaeftsleitung) return allPages
    if (!onlyMine && !onlyUnconfirmed) return allPages
    // Schritt 1: "Direkt-Treffer" sammeln. Eine Page ist Direkt-Treffer wenn
    //   - onlyMine aktiv: ich in relevantFuer
    //   - onlyUnconfirmed aktiv (Solo): ich in relevantFuer UND nicht bestätigt
    //   - beide aktiv: ich in relevantFuer UND nicht bestätigt
    const directHits = new Set(
      allPages.filter(p => {
        const forMe = isPageForMe(p)
        if (onlyMine && !forMe) return false
        if (!onlyMine && onlyUnconfirmed && !forMe) return false  // Solo-Unconfirmed = nur meine SOPs die ich nicht bestätigt habe
        if (onlyUnconfirmed && myConfirmedIds.has(p.id)) return false
        return forMe || !onlyMine   // bei !onlyMine kommt jede Page durch außer den oben gefilterten
      }).map(p => p.id),
    )
    return allPages.filter(p => directHits.has(p.id) || (p.parentPageId && directHits.has(p.parentPageId)))
  }, [allPages, onlyMine, onlyUnconfirmed, myConfirmedIds, displayName, username, isAdmin, isGeschaeftsleitung])

  const myRelevantCount = useMemo(
    () => allPages.filter(isPageForMe).length,
    [allPages, displayName, username],
  )
  const myUnconfirmedCount = useMemo(
    () => allPages.filter(p => isPageForMe(p) && !myConfirmedIds.has(p.id) && p.status === 'final').length,
    [allPages, myConfirmedIds, displayName, username],
  )

const subsOf      = (sId: string)    => subsections.filter(ss => ss.sectionId === sId)
  const pagesOf     = (ssId: string)   => visiblePages.filter(p => p.subsectionId === ssId && !p.parentPageId)
  const subPagesOf  = (pageId: string) => visiblePages.filter(p => p.parentPageId === pageId)
  const togglePage  = (id: string)     => setExpandedPages(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const activePage       = allPages.find(p => p.id === activePageId) ?? null
  const activeSubsection = subsections.find(ss => ss.id === activePage?.subsectionId)
  const activeSection    = sections.find(s => s.id === activePage?.sectionId)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ob-sections'] })
    qc.invalidateQueries({ queryKey: ['ob-subsections'] })
    qc.invalidateQueries({ queryKey: ['ob-pages'] })
  }

  const loadPageViews = async (pageId: string) => {
    setViewersLoading(true)
    setPageViews([])
    try {
      const views = await getPageViews(pageId)
      setPageViews(views)
    } finally {
      setViewersLoading(false)
    }
  }

  const selectPage = (p: OnboardingPage) => {
    setActivePageId(p.id)
    setPageTitle(p.title)
    setPageContent(p.content)
    setPageZustaendig(p.zustaendig ?? p.createdBy ?? '')
    setPageFreigabeDurch(p.freigabeDurch ?? '')
    setPageVersion(String(p.version ?? ''))
    setPageGueltigAb(p.gueltigAb ?? '')
    setPageDirty(false)
    setSearch('')
    setShowViewers(false)
    setPageViews([])
    setPageRelevantFuer(p.relevantFuer ?? [])
    setShowRelevantFuer(false)
    setShowNachweis(false)
    setShowVersionen(false)
    setPageVersions([])
    navigate(`/sop/page/${p.id}`)
    // Load confirmations
    if (canViewRecords) setTimeout(() => loadPageViews(p.id), 300)
  }

  // Versionshistorie laden — lazy beim ersten Aufklappen, oder beim Page-Switch
  // wenn die Sektion offen war (kann je nach UX preference invalidiert werden).
  const loadPageVersions = useCallback(async (id: string) => {
    setVersionsLoading(true)
    try {
      const list = await getPageVersions(id)
      setPageVersions(list)
    } finally {
      setVersionsLoading(false)
    }
  }, [])
  useEffect(() => {
    if (showVersionen && activePageId && pageVersions.length === 0 && !versionsLoading) {
      loadPageVersions(activePageId)
    }
  }, [showVersionen, activePageId])  // eslint-disable-line react-hooks/exhaustive-deps

  // Sync URL → state: direkter Aufruf via Link oder Browser-Zurück
  useEffect(() => {
    if (!urlPageId || allPages.length === 0) return
    if (activePageId === urlPageId) return
    const page = allPages.find(p => p.id === urlPageId)
    if (!page) return
    setActivePageId(page.id)
    setPageTitle(page.title)
    setPageContent(page.content)
    setPageZustaendig(page.zustaendig ?? page.createdBy ?? '')
    setPageFreigabeDurch(page.freigabeDurch ?? '')
    setPageVersion(String(page.version ?? ''))
    setPageGueltigAb(page.gueltigAb ?? '')
    setPageDirty(false)
    setSearch('')
    setShowViewers(false)
    setPageViews([])
    setPageRelevantFuer(page.relevantFuer ?? [])
    setShowRelevantFuer(false)
    setShowNachweis(false)
    if (canViewRecords) setTimeout(() => loadPageViews(page.id), 300)
  }, [urlPageId, allPages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSection    = (id: string) => setExpandedSections(s    => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleSubsection = (id: string) => setExpandedSubsections(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Auto-expand when page becomes active
  useEffect(() => {
    if (!activePage) return
    setExpandedSections(s    => new Set([...s, activePage.sectionId]))
    setExpandedSubsections(s => new Set([...s, activePage.subsectionId]))
    if (activePage.parentPageId) {
      setExpandedPages(s => new Set([...s, activePage.parentPageId!]))
    }
  }, [activePage?.id])

  // Keyboard shortcut: Ctrl+F / Cmd+F → focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
      if (e.key === 'Escape' && search) setSearch('')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [search])

  // Close viewers panel on outside click
  useEffect(() => {
    if (!showViewers) return
    const handler = (e: MouseEvent) => {
      if (viewersPanelRef.current && !viewersPanelRef.current.contains(e.target as Node)) {
        setShowViewers(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showViewers])

  // ── Search results (memoized) ─────────────────────────────────────────────
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []

    return visiblePages
      .filter(page => {
        const titleMatch   = page.title.toLowerCase().includes(q)
        const contentMatch = stripHtml(page.content).toLowerCase().includes(q)
        return titleMatch || contentMatch
      })
      .map(page => {
        const section    = sections.find(s => s.id === page.sectionId)
        const subsection = subsections.find(ss => ss.id === page.subsectionId)
        const plain      = stripHtml(page.content)
        const excerpt    = plain.toLowerCase().includes(q)
          ? getExcerpt(plain, search.trim())
          : ''
        return { page, section, subsection, excerpt }
      })
  }, [search, visiblePages, sections, subsections])

  const handleRelease = async () => {
    if (!activePageId) return
    setReleasing(true)
    try {
      const newVersion = incrementVersion(pageVersionRef.current)
      // releasePage archiviert automatisch den bisherigen final-Stand
      // (falls die Page schon mal released war). resetViews:true heisst:
      // Schulungsnachweise werden bei jedem Release zurückgesetzt — alle
      // Relevanten müssen die neue Version explizit nochmal bestätigen.
      await releasePage(activePageId, pageGueltigAbRef.current || undefined, newVersion, {
        archivedBy:    displayName,
        archiveReason: 'new-version-released',
        resetViews:    true,
      })
      setPageVersion(newVersion)
      setPageViews([])
      // Versionshistorie ggf. neu laden (falls die Sektion offen ist)
      setPageVersions([])
      if (showVersionen) loadPageVersions(activePageId)
      // Alle "Relevant für"-User über neue Version informieren (außer den Releaser
      // selbst; eigene UID-Filter macht notifySopRelevanceBulk).
      const recipientUids = namesToUids(pageRelevantFuer)
      if (recipientUids.length > 0 && activePage) {
        await notifySopRelevanceBulk(
          recipientUids, activePageId, activePage.title || pageTitle, displayName, profile?.uid ?? '', 'sop_release',
        )
      }
      refresh()
    } finally {
      setReleasing(false)
    }
  }

  // ── Zurück zu Entwurf ─────────────────────────────────────────────────────
  const [settingDraft, setSettingDraft] = useState(false)

  const handleSetToDraft = async () => {
    if (!activePageId) return
    setSettingDraft(true)
    try {
      await setPageToDraft(activePageId)
      setPageViews([])
      refresh()
    } finally {
      setSettingDraft(false)
    }
  }

  // ── Schulungsnachweis: explicit confirmation ──────────────────────────────
  const isRelevantFuerPage = pageRelevantFuer.some(n => n === displayName || n === username)
  const hasConfirmed = pageViews.some(v => v.username === username || v.displayName === displayName)

  const handleConfirm = async () => {
    if (!activePageId) return
    setConfirming(true)
    try {
      await recordPageView(activePageId, username, displayName)
      await loadPageViews(activePageId)
      // Optimistic update — Confirmed-Set gleich erweitern damit der Filter
      // "Nur unbestätigte" sofort die SOP aus der Sidebar nimmt.
      setMyConfirmedIds(prev => new Set([...prev, activePageId]))
    } finally {
      setConfirming(false)
    }
  }

  /** Resolve displayName → uid via sopUsers. Notify nur User die wir kennen. */
  const namesToUids = (names: string[]): string[] => {
    const lookup = new Map(sopUsers.map(u => [u.displayName, u.uid]))
    return names.map(n => lookup.get(n) || '').filter(Boolean)
  }
  /** Benachrichtigt alle frisch hinzugefügten User über ihre neue SOP-Relevanz.
   *  Aktive Page wird vorausgesetzt (Title/Id aus activePage). */
  const notifyNewlyRelevant = async (addedNames: string[]) => {
    if (!activePageId || !activePage || addedNames.length === 0) return
    const uids = namesToUids(addedNames)
    if (uids.length === 0) return
    await notifySopRelevanceBulk(uids, activePageId, activePage.title || pageTitle, displayName, profile?.uid ?? '', 'sop_relevance')
  }

  const handleToggleRelevantFuer = async (name: string) => {
    if (!activePageId) return
    const wasIncluded = pageRelevantFuer.includes(name)
    const next = wasIncluded
      ? pageRelevantFuer.filter(n => n !== name)
      : [...pageRelevantFuer, name]
    setPageRelevantFuer(next)
    await updatePageMeta(activePageId, { relevantFuer: next })
    if (!wasIncluded) await notifyNewlyRelevant([name])
  }

  /** Setzt die Liste auf den exakten Inhalt (ohne Toggle-Logik). Genutzt von
   *  den Gruppen-Buttons unten. */
  const replaceRelevantFuer = async (names: string[]) => {
    if (!activePageId) return
    // Dedupliziere und sortiere defensiv
    const next = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'de'))
    // Diff zur vorigen Liste — Notify nur die NEU dazugekommenen
    const previousSet = new Set(pageRelevantFuer)
    const newlyAdded  = next.filter(n => !previousSet.has(n))
    setPageRelevantFuer(next)
    await updatePageMeta(activePageId, { relevantFuer: next })
    if (newlyAdded.length > 0) await notifyNewlyRelevant(newlyAdded)
  }
  /** Fügt alle übergebenen Namen zur Liste hinzu (Union ohne Duplikate). */
  const addToRelevantFuer = (names: string[]) =>
    replaceRelevantFuer([...pageRelevantFuer, ...names])
  /** Entfernt alle übergebenen Namen aus der Liste. */
  const removeFromRelevantFuer = (names: string[]) => {
    const remove = new Set(names)
    return replaceRelevantFuer(pageRelevantFuer.filter(n => !remove.has(n)))
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const handleAddSection = async (title: string) => {
    const id = await addSection(title, sectionColor, sections.length)
    setExpandedSections(s => new Set([...s, id]))
    setAddingSection(false)
    setSectionColor('purple')
    refresh()
  }

  const handleAddSubsection = async (title: string) => {
    if (!addingSubsectionFor) return
    const id = await addSubsection(addingSubsectionFor, title, subsOf(addingSubsectionFor).length)
    setExpandedSubsections(s => new Set([...s, id]))
    setAddingSubsectionFor(null)
    refresh()
  }

  const handleAddPage = async (title: string) => {
    if (!addingPageFor) return
    const ss = subsections.find(s => s.id === addingPageFor)
    if (!ss) return
    const id = await addPage(addingPageFor, ss.sectionId, title, pagesOf(addingPageFor).length, username)
    setAddingPageFor(null)
    refresh()
    setTimeout(() => {
      const p = allPages.find(x => x.id === id)
      if (p) selectPage(p)
    }, 400)
  }

  const handleAddSubPage = async (title: string) => {
    if (!addingSubPageFor) return
    const parent = allPages.find(p => p.id === addingSubPageFor)
    if (!parent) return
    setExpandedPages(s => new Set([...s, parent.id]))
    await addPage(parent.subsectionId, parent.sectionId, title, subPagesOf(parent.id).length, username, parent.id)
    setAddingSubPageFor(null)
    refresh()
  }

  const handleSavePage = useCallback(async () => {
    const id      = activePageIdRef.current
    const title   = pageTitleRef.current
    const content = pageContentRef.current
    if (!id) return
    setPageSaving(true)
    try {
      await updatePage(id, title, content, username, {
        zustaendig:    pageZustaendigRef.current    || undefined,
        freigabeDurch: pageFreigabeDurchRef.current || undefined,
        version:       pageVersionRef.current       || undefined,
        gueltigAb:     pageGueltigAbRef.current     || undefined,
      })
      setPageDirty(false)
      setPageSaved(true)
      if (savedFadeTimer.current) clearTimeout(savedFadeTimer.current)
      savedFadeTimer.current = setTimeout(() => setPageSaved(false), 2500)
      refresh()
    } finally {
      setPageSaving(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save: 1.5 s after last change
  useEffect(() => {
    if (!pageDirty) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => { handleSavePage() }, 1500)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [pageTitle, pageContent, pageDirty, handleSavePage])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      if (deleteTarget.type === 'section')    await deleteSection(deleteTarget.item.id)
      if (deleteTarget.type === 'subsection') await deleteSubsection(deleteTarget.item.id, (deleteTarget.item as OnboardingSubsection).sectionId)
      if (deleteTarget.type === 'page') {
        await deletePage(deleteTarget.item.id)
        if (activePageId === deleteTarget.item.id) { setActivePageId(null); setPageTitle(''); setPageContent('') }
      }
      refresh()
    } finally { setDeleting(false); setDeleteTarget(null) }
  }

  const handlePageDrop = async (subsectionId: string, targetPageId: string) => {
    if (!draggedPageId || draggedPageId === targetPageId) return
    const pages = pagesOf(subsectionId)
    const from  = pages.findIndex(p => p.id === draggedPageId)
    const to    = pages.findIndex(p => p.id === targetPageId)
    if (from === -1 || to === -1) return
    const reordered = [...pages]
    const [moved]   = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    setDraggedPageId(null)
    setDragOverPageId(null)
    await reorderPages(reordered.map((p, i) => ({ id: p.id, order: i })))
    refresh()
  }

  /** Move-Modal initialisieren: Zielsection/-subsection auf den aktuellen
   *  Standort vorbelegen, Parent-Page leer (= zur Top-Level). */
  const openMoveModal = (page: OnboardingPage) => {
    setMovingPage(page)
    setMoveTargetSection(page.sectionId)
    setMoveTargetSubsection(page.subsectionId)
    setMoveTargetParentPage(page.parentPageId ?? '')
  }
  const handleMoveSave = async () => {
    if (!movingPage) return
    setMoveSaving(true)
    try {
      // Order = ans Ende der Ziel-Liste (max+1)
      const siblingsInTarget = moveTargetParentPage
        ? allPages.filter(p => p.parentPageId === moveTargetParentPage)
        : allPages.filter(p => p.subsectionId === moveTargetSubsection && !p.parentPageId)
      const nextOrder = siblingsInTarget.reduce((m, p) => Math.max(m, p.order ?? 0), -1) + 1

      if (moveTargetParentPage) {
        await movePage(movingPage.id, { type: 'subpage', parentPageId: moveTargetParentPage }, nextOrder)
      } else {
        await movePage(movingPage.id, { type: 'subsection', sectionId: moveTargetSection, subsectionId: moveTargetSubsection }, nextOrder)
      }
      setMovingPage(null)
      refresh()
    } finally { setMoveSaving(false) }
  }

  const handleSubPageDrop = async (parentPageId: string, targetSubPageId: string) => {
    if (!draggedPageId || draggedPageId === targetSubPageId) return
    const subs = subPagesOf(parentPageId)
    const from = subs.findIndex(p => p.id === draggedPageId)
    const to   = subs.findIndex(p => p.id === targetSubPageId)
    if (from === -1 || to === -1) return
    const reordered = [...subs]
    const [moved]   = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    setDraggedPageId(null)
    setDragOverPageId(null)
    await reorderPages(reordered.map((p, i) => ({ id: p.id, order: i })))
    refresh()
  }

  const isSearching = search.trim().length > 0

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">

      {/* ── Left panel ── */}
      <div className={cn(
        'shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col overflow-hidden transition-[width] duration-200',
        sidebarOpen ? 'w-64' : 'w-9',
      )}>

        {/* Header */}
        <div className="flex items-center justify-between px-2 py-2.5 border-b border-gray-200 shrink-0 gap-1">
          {sidebarOpen && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <BackButton label="" fallback="/" className="inline-flex items-center text-gray-400 hover:text-gray-700 transition-colors" />
              <span className="text-xs font-bold uppercase tracking-widest text-gray-400 truncate">SOP</span>
            </div>
          )}
          <div className="flex items-center gap-0.5 shrink-0">
            {canEdit && sidebarOpen && !isSearching && (
              <button onClick={() => setAddingSection(true)} className="p-1 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50" title="Neuer Abschnitt">
                <Plus className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => setSidebarOpen(v => !v)}
              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title={sidebarOpen ? 'Seitenleiste einklappen' : 'Seitenleiste ausklappen'}
            >
              {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Search + Tree – only visible when expanded */}
        {sidebarOpen && <>

        {/* Search input */}
        <div className="px-2 py-2 border-b border-gray-200 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Suchen… (Ctrl+F)"
              className="w-full pl-7 pr-6 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-400 bg-white placeholder:text-gray-400"
            />
            {search && (
              <button
                onClick={() => { setSearch(''); searchInputRef.current?.focus() }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {isSearching && (
            <p className="text-[10px] text-gray-400 mt-1 px-0.5">
              {searchResults.length === 0 ? 'Keine Ergebnisse' : `${searchResults.length} Ergebnis${searchResults.length === 1 ? '' : 'se'}`}
            </p>
          )}
          {/* Filter-Toggles für normale User (Admins/GL sehen sie nicht).
              Zwei Stufen: "Nur meine SOPs" und darunter "Nur unbestätigte". */}
          {!isAdmin && !isGeschaeftsleitung && (
            <div className="mt-1.5 space-y-1">
              <button
                onClick={() => setOnlyMine(v => !v)}
                title={myRelevantCount === 0 ? 'Sie sind aktuell für keine SOP als "Relevant für" eingetragen' : ''}
                disabled={myRelevantCount === 0}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md text-[11px] font-medium transition-colors
                  ${onlyMine
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-50'}`}>
                <span className="flex items-center gap-1.5">
                  <Users className="w-3 h-3" />
                  {onlyMine ? 'Nur meine SOPs' : 'Nur meine SOPs anzeigen'}
                </span>
                <span className={`text-[10px] tabular-nums ${onlyMine ? 'opacity-90' : 'text-gray-500'}`}>
                  {myRelevantCount}
                </span>
              </button>
              <button
                onClick={() => setOnlyUnconfirmed(v => !v)}
                title={myUnconfirmedCount === 0 ? 'Sie haben alle Ihnen zugewiesenen SOPs bereits bestätigt' : ''}
                disabled={myUnconfirmedCount === 0}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md text-[11px] font-medium transition-colors
                  ${onlyUnconfirmed
                    ? 'bg-amber-600 text-white hover:bg-amber-700'
                    : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-amber-50'}`}>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  {onlyUnconfirmed ? 'Nur unbestätigte' : 'Nur unbestätigte anzeigen'}
                </span>
                <span className={`text-[10px] tabular-nums ${onlyUnconfirmed ? 'opacity-90' : 'text-gray-500'}`}>
                  {myUnconfirmedCount}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* ── Search results ── */}
        {isSearching ? (
          <div className="flex-1 overflow-y-auto py-1">
            {searchResults.length === 0 ? (
              <p className="text-xs text-gray-400 px-3 py-6 text-center">Keine Ergebnisse für<br /><span className="font-medium text-gray-600">«{search}»</span></p>
            ) : (
              searchResults.map(({ page, section, subsection, excerpt }) => (
                <button
                  key={page.id}
                  onClick={() => selectPage(page)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 border-b border-gray-100 hover:bg-white transition-colors',
                    activePageId === page.id ? 'bg-primary-50 border-l-2 border-l-primary-500' : '',
                  )}
                >
                  {/* Page title */}
                  <p className="text-xs font-semibold text-gray-800 leading-snug mb-0.5 line-clamp-2">
                    <Highlight text={page.title} query={search.trim()} />
                  </p>
                  {/* Path */}
                  <p className="text-[10px] text-gray-400 mb-1 truncate">
                    {section?.title}{subsection ? ` › ${subsection.title}` : ''}
                  </p>
                  {/* Excerpt */}
                  {excerpt && (
                    <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2">
                      <Highlight text={excerpt} query={search.trim()} />
                    </p>
                  )}
                </button>
              ))
            )}
          </div>
        ) : (
          /* ── Normal tree ── */
          <div className="flex-1 py-1 overflow-y-auto">
            {/* Add section form */}
            {addingSection && (
              <div className="border-b border-gray-200 bg-white pb-2">
                <QuickInput placeholder="Abschnittsname" onSave={handleAddSection} onCancel={() => setAddingSection(false)} />
                <div className="flex gap-1.5 px-2">
                  {SECTION_COLORS.map(c => (
                    <button key={c.id} onClick={() => setSectionColor(c.id)}
                      className={cn('w-4 h-4 rounded-full', c.bg, sectionColor === c.id ? 'ring-2 ring-offset-1 ring-gray-500' : '')} />
                  ))}
                </div>
              </div>
            )}

            {sections.length === 0 && !addingSection && (
              <p className="text-xs text-gray-400 px-3 py-4 text-center">Noch keine Abschnitte</p>
            )}

            {sections.map(section => {
              const color    = getColor(section.color)
              const sExpanded = expandedSections.has(section.id)
              const subs     = subsOf(section.id)

              return (
                <div key={section.id}>
                  {/* ── Section row ── */}
                  <div className="group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleSection(section.id)}>
                    {sExpanded ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />}
                    <span className={cn('w-3 h-3 rounded-sm shrink-0', color.bg)} />
                    {editingSection?.id === section.id ? (
                      <input autoFocus className="input text-xs py-0 flex-1" defaultValue={section.title}
                        onBlur={e => { updateSection(section.id, e.target.value || section.title, section.color).then(refresh); setEditingSection(null) }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingSection(null) }}
                        onClick={e => e.stopPropagation()} />
                    ) : (
                      <span className="flex-1 text-sm font-semibold text-gray-700 truncate">{section.title}</span>
                    )}
                    {canEdit && !editingSection && (
                      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                        <button onClick={e => { e.stopPropagation(); setEditingSection(section) }} className="p-0.5 text-gray-400 hover:text-primary-600"><Pencil className="w-3 h-3" /></button>
                        <button onClick={e => { e.stopPropagation(); setDeleteTarget({ type: 'section', item: section }) }} className="p-0.5 text-gray-400 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    )}
                  </div>

                  {/* ── Subsections ── */}
                  {sExpanded && (
                    <div className="ml-5">
                      {subs.map(ss => {
                        const ssExpanded = expandedSubsections.has(ss.id)
                        const pages = pagesOf(ss.id)

                        return (
                          <div key={ss.id}>
                            {/* Subsection row */}
                            <div className="group flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-gray-100"
                              onClick={() => toggleSubsection(ss.id)}>
                              {ssExpanded ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />}
                              <FolderOpen className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              {editingSubsection?.id === ss.id ? (
                                <input autoFocus className="input text-xs py-0 flex-1" defaultValue={ss.title}
                                  onBlur={e => { updateSubsection(ss.id, e.target.value || ss.title).then(refresh); setEditingSubsection(null) }}
                                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingSubsection(null) }}
                                  onClick={e => e.stopPropagation()} />
                              ) : (
                                <span className="flex-1 text-xs font-medium text-gray-600 truncate">{ss.title}</span>
                              )}
                              {canEdit && !editingSubsection && (
                                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                                  <button onClick={e => { e.stopPropagation(); setEditingSubsection(ss) }} className="p-0.5 text-gray-400 hover:text-primary-600"><Pencil className="w-3 h-3" /></button>
                                  <button onClick={e => { e.stopPropagation(); setDeleteTarget({ type: 'subsection', item: ss }) }} className="p-0.5 text-gray-400 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                                </div>
                              )}
                            </div>

                            {/* Pages */}
                            {ssExpanded && (
                              <div className="ml-5">
                                {pages.map(page => {
                                  const subPages   = subPagesOf(page.id)
                                  const pgExpanded = expandedPages.has(page.id)
                                  const hasChildren = subPages.length > 0 || addingSubPageFor === page.id

                                  return (
                                    <div key={page.id}>
                                      {/* Page row */}
                                      <div
                                        draggable={canEdit && !editingPage}
                                        onDragStart={e => { e.stopPropagation(); setDraggedPageId(page.id) }}
                                        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverPageId(page.id) }}
                                        onDragLeave={() => setDragOverPageId(null)}
                                        onDrop={e => { e.preventDefault(); e.stopPropagation(); handlePageDrop(ss.id, page.id) }}
                                        onDragEnd={() => { setDraggedPageId(null); setDragOverPageId(null) }}
                                        className={cn(
                                          'group flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-gray-100 rounded-sm text-xs transition-colors',
                                          activePageId === page.id ? cn('font-semibold', color.light) : 'text-gray-600',
                                          draggedPageId === page.id && 'opacity-40',
                                          dragOverPageId === page.id && draggedPageId !== page.id && 'border-t-2 border-primary-400',
                                        )}
                                        onClick={() => selectPage(page)}>
                                        {canEdit && !editingPage && (
                                          <GripVertical className="w-3 h-3 text-gray-300 group-hover:text-gray-400 shrink-0 cursor-grab active:cursor-grabbing" />
                                        )}
                                        {/* Expand chevron for sub-pages */}
                                        {(hasChildren || canEdit) ? (
                                          <button
                                            onClick={e => { e.stopPropagation(); togglePage(page.id) }}
                                            className="shrink-0 text-gray-400 hover:text-gray-600"
                                          >
                                            {pgExpanded
                                              ? <ChevronDown className="w-3 h-3" />
                                              : <ChevronRight className="w-3 h-3" />}
                                          </button>
                                        ) : (
                                          <FileText className="w-3 h-3 text-gray-400 shrink-0" />
                                        )}
                                        {editingPage?.id === page.id ? (
                                          <input autoFocus className="input text-xs py-0 flex-1" defaultValue={page.title}
                                            onBlur={e => { updatePage(page.id, e.target.value || page.title, page.content).then(refresh); setEditingPage(null) }}
                                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingPage(null) }}
                                            onClick={e => e.stopPropagation()} />
                                        ) : (
                                          <span className="flex-1 truncate flex items-center gap-1">
                                            {page.title}
                                            {page.status !== 'final' && (
                                              <span title="Entwurf — wartet auf Freigabe" className="shrink-0 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-600 border border-amber-200 leading-none">E</span>
                                            )}
                                            {!isAdmin && !isGeschaeftsleitung && isPageForMe(page) && page.status === 'final' && (
                                              myConfirmedIds.has(page.id)
                                                ? <span title="Sie haben diese SOP bereits bestätigt" className="shrink-0 inline-flex"><Check className="w-3 h-3 text-green-600" /></span>
                                                : <span title="Noch nicht bestätigt — bitte lesen und bestätigen" className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" />
                                            )}
                                          </span>
                                        )}
                                        {canEdit && !editingPage && (
                                          <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                                            <button title="Umbenennen" onClick={e => { e.stopPropagation(); setEditingPage(page) }} className="p-0.5 text-gray-400 hover:text-primary-600"><Pencil className="w-3 h-3" /></button>
                                            <button title="In andere Kategorie verschieben" onClick={e => { e.stopPropagation(); openMoveModal(page) }} className="p-0.5 text-gray-400 hover:text-amber-600"><ArrowRightLeft className="w-3 h-3" /></button>
                                            <button title="Löschen" onClick={e => { e.stopPropagation(); setDeleteTarget({ type: 'page', item: page }) }} className="p-0.5 text-gray-400 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                                          </div>
                                        )}
                                      </div>

                                      {/* Sub-pages */}
                                      {pgExpanded && (
                                        <div className="ml-5 border-l border-gray-200">
                                          {subPages.map(sub => (
                                            <div key={sub.id}
                                              draggable={canEdit && !editingPage}
                                              onDragStart={e => { e.stopPropagation(); setDraggedPageId(sub.id) }}
                                              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverPageId(sub.id) }}
                                              onDragLeave={() => setDragOverPageId(null)}
                                              onDrop={e => { e.preventDefault(); e.stopPropagation(); handleSubPageDrop(page.id, sub.id) }}
                                              onDragEnd={() => { setDraggedPageId(null); setDragOverPageId(null) }}
                                              className={cn(
                                                'group flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-gray-100 rounded-sm text-xs transition-colors',
                                                activePageId === sub.id ? cn('font-semibold', color.light) : 'text-gray-500',
                                                draggedPageId === sub.id && 'opacity-40',
                                                dragOverPageId === sub.id && draggedPageId !== sub.id && 'border-t-2 border-primary-400',
                                              )}
                                              onClick={() => selectPage(sub)}>
                                              {canEdit && !editingPage && (
                                                <GripVertical className="w-3 h-3 text-gray-300 group-hover:text-gray-400 shrink-0 cursor-grab active:cursor-grabbing" />
                                              )}
                                              <FileText className="w-3 h-3 text-gray-300 shrink-0" />
                                              {editingPage?.id === sub.id ? (
                                                <input autoFocus className="input text-xs py-0 flex-1" defaultValue={sub.title}
                                                  onBlur={e => { updatePage(sub.id, e.target.value || sub.title, sub.content).then(refresh); setEditingPage(null) }}
                                                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingPage(null) }}
                                                  onClick={e => e.stopPropagation()} />
                                              ) : (
                                                <span className="flex-1 truncate flex items-center gap-1">
                                                  {sub.title}
                                                  {sub.status !== 'final' && (
                                                    <span title="Entwurf — wartet auf Freigabe" className="shrink-0 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-600 border border-amber-200 leading-none">E</span>
                                                  )}
                                                </span>
                                              )}
                                              {canEdit && !editingPage && (
                                                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                                                  <button title="Umbenennen" onClick={e => { e.stopPropagation(); setEditingPage(sub) }} className="p-0.5 text-gray-400 hover:text-primary-600"><Pencil className="w-3 h-3" /></button>
                                                  <button title="Verschieben (zu anderer Sektion oder anderer Hauptseite)" onClick={e => { e.stopPropagation(); openMoveModal(sub) }} className="p-0.5 text-gray-400 hover:text-amber-600"><ArrowRightLeft className="w-3 h-3" /></button>
                                                  <button title="Löschen" onClick={e => { e.stopPropagation(); setDeleteTarget({ type: 'page', item: sub }) }} className="p-0.5 text-gray-400 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                          {canEdit && (
                                            addingSubPageFor === page.id
                                              ? <QuickInput placeholder="Unterseitenname" onSave={handleAddSubPage} onCancel={() => setAddingSubPageFor(null)} />
                                              : <button onClick={e => { e.stopPropagation(); setAddingSubPageFor(page.id) }}
                                                  className="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-400 hover:text-primary-600 w-full">
                                                  <Plus className="w-3 h-3" /> Unterseite
                                                </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                                {/* Add page */}
                                {canEdit && (
                                  addingPageFor === ss.id
                                    ? <QuickInput placeholder="Seitenname" onSave={handleAddPage} onCancel={() => setAddingPageFor(null)} />
                                    : <button onClick={() => setAddingPageFor(ss.id)}
                                        className="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-400 hover:text-primary-600 w-full">
                                        <Plus className="w-3 h-3" /> Seite
                                      </button>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {/* Add subsection */}
                      {canEdit && (
                        addingSubsectionFor === section.id
                          ? <QuickInput placeholder="Unterabschnittsname" onSave={handleAddSubsection} onCancel={() => setAddingSubsectionFor(null)} />
                          : <button onClick={() => setAddingSubsectionFor(section.id)}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-primary-600 w-full">
                              <Plus className="w-3 h-3" /> Unterabschnitt
                            </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        </> /* end sidebarOpen */}
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        {!activePage ? (
          <div className="flex-1 overflow-y-auto px-10 py-10 max-w-3xl mx-auto w-full">
            {/* Vorwort */}
            <div className="flex items-center gap-3 mb-6">
              <div className="w-1 h-12 rounded-full bg-primary-500 shrink-0" />
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-primary-500 mb-0.5">Vorwort</p>
                <h1 className="text-3xl font-bold text-gray-900 leading-tight">Standard Operating Procedures</h1>
              </div>
            </div>

            <div className="prose prose-sm max-w-none text-gray-700 space-y-4">
              <p className="text-base leading-relaxed">
                Willkommen im SOP-Bereich des Augenzentrums Suhr. Diese Sammlung enthält
                verbindliche Schritt-für-Schritt-Anleitungen für alle wiederkehrenden Abläufe
                in unserer Praxis.
              </p>

              <div className="bg-primary-50 border border-primary-100 rounded-xl p-5 space-y-3">
                <div>
                  <p className="font-semibold text-primary-800 mb-1">Was ist eine SOP?</p>
                  <p className="text-sm text-primary-700 leading-relaxed">
                    Eine <em>Standard Operating Procedure</em> (SOP) ist eine schriftlich festgelegte Anleitung,
                    die beschreibt, wie ein bestimmter Prozess einheitlich und korrekt durchzuführen ist —
                    unabhängig davon, welche Person ihn ausführt.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-primary-800 mb-1">Wofür dienen SOPs?</p>
                  <p className="text-sm text-primary-700 leading-relaxed">
                    SOPs stellen sicher, dass alle Mitarbeitenden Abläufe auf dieselbe Weise durchführen.
                    Sie decken alle Bereiche ab: Praxisöffnung, Voruntersuchungen, Geräte &amp; Messungen,
                    Operationsvorbereitungen und Administration.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-primary-800 mb-1">Ziel</p>
                  <p className="text-sm text-primary-700 leading-relaxed">
                    Qualitätssicherung, Fehlerminimierung und eine schnelle, strukturierte Einarbeitung
                    neuer Mitarbeitender. Der SOP-Bereich dient gleichzeitig als digitales Nachschlagewerk
                    im täglichen Betrieb.
                  </p>
                </div>
              </div>

              <p className="text-sm text-gray-500 leading-relaxed">
                Wählen Sie links in der Seitenleiste einen <strong>Abschnitt</strong>, dann einen
                <strong> Unterabschnitt</strong> und schliesslich eine <strong>Seite</strong>, um
                die gewünschte SOP anzuzeigen.
              </p>
            </div>

            <div className="mt-8 border-t border-gray-100 pt-6 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Zugriff &amp; Berechtigungen</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-gray-600 [&>div]:col-auto">
                <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                  <p className="font-semibold text-green-800 mb-1">✏️ Zuständig — Bearbeiten</p>
                  <p className="text-green-700 leading-relaxed">
                    Die als «Zuständig» eingetragene Person kann den Inhalt der SOP bearbeiten und speichern.
                    Administratoren können Seiten erstellen, zuweisen und ebenfalls bearbeiten.
                  </p>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                  <p className="font-semibold text-blue-800 mb-1">✅ Freigabe — Gültig ab setzen</p>
                  <p className="text-blue-700 leading-relaxed">
                    Die als «Freigabe» eingetragene Person liest den Entwurf, setzt das «Gültig ab»-Datum
                    und klickt auf «Freigeben» (4-Augen-Prinzip — muss eine andere Person sein als die zuständige).
                  </p>
                </div>
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
                  <p className="font-semibold text-purple-800 mb-1">👁️ Alle anderen — Nur lesen</p>
                  <p className="text-purple-700 leading-relaxed">
                    Alle anderen Benutzer sehen freigegebene SOPs in der Leseansicht.
                    Entwürfe sind für sie nicht sichtbar.
                  </p>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                  <p className="font-semibold text-amber-800 mb-1">📋 Entwürfe</p>
                  <p className="text-amber-700 leading-relaxed">
                    Entwürfe sind nur für Administratoren, die zuständige Person und die Freigabe-Person sichtbar —
                    bis das «Gültig ab»-Datum gesetzt und die Seite freigegeben wurde.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Page header */}
            <div className={cn('px-8 pt-5 pb-3 border-b border-gray-100 shrink-0', activeSection ? getColor(activeSection.color).light : '')}>
              <div className="flex items-start gap-3">
                {activeSection && <span className={cn('w-1 self-stretch rounded-full shrink-0 my-0.5', getColor(activeSection.color).bg)} />}
                <div className="flex-1 min-w-0">
                  {(isAdmin || isGeschaeftsleitung || isZustaendigFor(activePage)) ? (
                    <input
                      className="text-2xl font-semibold text-gray-900 bg-transparent border-none outline-none w-full"
                      value={pageTitle}
                      onChange={e => { setPageTitle(e.target.value); setPageDirty(true) }}
                      placeholder="Seitentitel"
                    />
                  ) : (
                    <h1 className="text-2xl font-semibold text-gray-900">{activePage.title}</h1>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {activeSection?.title}
                    {activeSubsection && <> &rsaquo; <span className="text-gray-500">{activeSubsection.title}</span></>}
                  </p>
                </div>

                {/* Toggle Vorschau-Modus — nur für editierende Nutzer relevant;
                    schaltet zwischen Edit-Modus und Read-Only mit Glossar-Tooltips. */}
                {(isAdmin || isGeschaeftsleitung || isZustaendigFor(activePage)) && (
                  <button
                    type="button"
                    onClick={() => setPreviewMode(v => !v)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors shrink-0 mt-0.5',
                      previewMode
                        ? 'bg-cyan-50 text-cyan-700 border-cyan-200 hover:bg-cyan-100'
                        : 'bg-white/60 text-gray-600 hover:text-primary-700 hover:bg-white border-gray-200 hover:border-primary-200'
                    )}
                    title={previewMode ? 'Edit-Modus wieder einschalten' : 'Vorschau mit Glossar-Tooltips anzeigen'}
                  >
                    {previewMode
                      ? <EyeOff className="w-3.5 h-3.5" />
                      : <Eye    className="w-3.5 h-3.5" />}
                    <span className="hidden sm:inline">{previewMode ? 'Bearbeiten' : 'Vorschau'}</span>
                  </button>
                )}

                {/* Export-Button → öffnet Vorschau-Modal mit PDF-/Word-Option */}
                <button
                  type="button"
                  onClick={() => setShowExportPreview(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:text-primary-700 bg-white/60 hover:bg-white border border-gray-200 hover:border-primary-200 transition-colors shrink-0 mt-0.5"
                  title="Vorschau & Export (PDF / Word)"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Export</span>
                </button>

                {/* Metadata — manuell bearbeitbar */}
                <div className="text-[11px] text-gray-400 text-right leading-relaxed shrink-0 hidden sm:block space-y-1 min-w-[180px]">
                  {/* Zuständig — Admin oder GL */}
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="font-medium text-gray-500 shrink-0">Zuständig:</span>
                    {(isAdmin || isGeschaeftsleitung) ? (
                      <select
                        value={pageZustaendig}
                        onChange={e => { setPageZustaendig(e.target.value); setPageDirty(true) }}
                        className="text-[11px] text-gray-600 bg-transparent border-b border-dashed border-gray-200 hover:border-gray-400 focus:border-gray-500 outline-none w-32 cursor-pointer">
                        <option value="">—</option>
                        {sopUsers.map(u => (
                          <option key={u.uid} value={u.displayName}>{u.displayName}</option>
                        ))}
                      </select>
                    ) : (
                      <span>{pageZustaendig || '—'}</span>
                    )}
                  </div>
                  {/* Freigabe — Admin oder GL */}
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="font-medium text-gray-500 shrink-0">Freigabe:</span>
                    {(isAdmin || isGeschaeftsleitung) ? (
                      <select
                        value={pageFreigabeDurch}
                        onChange={e => { setPageFreigabeDurch(e.target.value); setPageDirty(true) }}
                        className="text-[11px] text-gray-600 bg-transparent border-b border-dashed border-gray-200 hover:border-gray-400 focus:border-gray-500 outline-none w-32 cursor-pointer">
                        <option value="">—</option>
                        {sopUsers.map(u => (
                          <option key={u.uid} value={u.displayName}>{u.displayName}</option>
                        ))}
                      </select>
                    ) : (
                      <span>{pageFreigabeDurch || '—'}</span>
                    )}
                  </div>
                  {/* Version — Admin, GL oder Zuständig */}
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="font-medium text-gray-500 shrink-0">Version:</span>
                    {(isAdmin || isGeschaeftsleitung || isZustaendigFor(activePage)) ? (
                      <input type="text" value={pageVersion}
                        onChange={e => { setPageVersion(e.target.value); setPageDirty(true) }}
                        placeholder="—"
                        className="text-[11px] text-gray-600 bg-transparent border-b border-dashed border-gray-200 hover:border-gray-400 focus:border-gray-500 outline-none text-right w-16 placeholder:text-gray-300" />
                    ) : (
                      <span>{pageVersion || '—'}</span>
                    )}
                  </div>
                  {/* Gültig ab — Admin oder Freigabe-Person (nicht Zuständig = 4-Augen) */}
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="font-medium text-gray-500 shrink-0">Gültig ab:</span>
                    {(isAdmin || isGeschaeftsleitung || (isFreigabeFor(activePage) && !isZustaendigFor(activePage))) && activePage.status !== 'final' ? (
                      <input type="date" value={pageGueltigAb}
                        onChange={e => { setPageGueltigAb(e.target.value); setPageDirty(true) }}
                        className="text-[11px] text-gray-600 bg-transparent border-b border-dashed border-gray-200 hover:border-gray-400 focus:border-gray-500 outline-none text-right w-28" />
                    ) : (
                      <span>{pageGueltigAb ? fmtDateStr(pageGueltigAb) : '—'}</span>
                    )}
                  </div>
                  {/* Freigabedatum (auto-set, read-only) */}
                  {activePage.freigabeDatum && (
                    <div><span className="font-medium text-gray-500">Freigegeben:</span> {fmtTs(activePage.freigabeDatum)}</div>
                  )}
                  {activePage.status !== 'final' && !pageFreigabeDurch && (
                    <div className="text-amber-500 font-medium">Ausstehende Freigabe</div>
                  )}
                  {canViewRecords && (
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <Users className="w-3 h-3 text-gray-400" />
                      <span className="font-medium text-gray-500">Schulungsnachweis:</span>
                      <span className="text-gray-600 font-semibold">{viewersLoading ? '…' : pageViews.length}</span>
                      {pageRelevantFuer.length > 0 && (
                        <span className="text-gray-400">/ {pageRelevantFuer.length}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  {/* Freigabe-Button — nur Freigabe-Person oder Admin, nicht Zuständige (4-Augen) */}
                  {activePage.status !== 'final' && (isFreigabeFor(activePage) || isAdmin || isGeschaeftsleitung) && !isZustaendigFor(activePage) && (
                    <button
                      onClick={handleRelease}
                      disabled={releasing || !pageGueltigAb}
                      title={!pageGueltigAb ? 'Zuerst ein «Gültig ab»-Datum setzen' : undefined}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {releasing ? 'Freigeben…' : 'Freigeben'}
                    </button>
                  )}
                  {/* Zurück zu Entwurf — nur Admin/GL, nur wenn freigegeben */}
                  {activePage.status === 'final' && (isAdmin || isGeschaeftsleitung) && (
                    <button
                      onClick={handleSetToDraft}
                      disabled={settingDraft}
                      title="Seite zurück auf Entwurf setzen und Schulungsnachweis löschen"
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white border border-gray-200 text-gray-500 rounded-lg hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-60"
                    >
                      {settingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
                      {settingDraft ? 'Wird zurückgesetzt…' : 'Zurück zu Entwurf'}
                    </button>
                  )}
                  {/* Speichern-Indikator */}
                  {(isAdmin || isGeschaeftsleitung || isZustaendigFor(activePage) || (isFreigabeFor(activePage) && !isZustaendigFor(activePage))) && (
                    <div className="text-xs flex items-center gap-1.5 min-w-[90px] justify-end">
                      {pageSaving ? (
                        <span className="text-gray-400 flex items-center gap-1">
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeLinecap="round"/></svg>
                          Speichern…
                        </span>
                      ) : pageSaved ? (
                        <span className="text-green-600 flex items-center gap-1 transition-opacity">
                          <Check className="w-3 h-3" /> Gespeichert
                        </span>
                      ) : pageDirty ? (
                        <span className="text-amber-500 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Nicht gespeichert
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Entwurf-Banner */}
            {activePage.status !== 'final' && (
              <div className="px-8 py-2 bg-amber-50 border-b border-amber-200 shrink-0 flex items-center gap-2 text-xs text-amber-700">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                {isZustaendigFor(activePage)
                  ? 'Sie sind als zuständige Person eingetragen. Bearbeiten Sie den Inhalt und speichern Sie. Die als Freigabe eingetragene Person kann danach das «Gültig ab»-Datum setzen und den Abschnitt freigeben.'
                  : (isFreigabeFor(activePage) || isAdmin) && !isZustaendigFor(activePage)
                    ? 'Entwurf bereit zur Freigabe — setzen Sie ein «Gültig ab»-Datum und klicken Sie auf «Freigeben», um diese SOP für alle sichtbar zu machen.'
                    : 'Entwurf — noch nicht veröffentlicht.'
                }
              </div>
            )}

            {/* Content – editor fills all remaining height.
                Edit-Modus (User darf editieren UND Preview-Toggle aus) → TipTap mit
                Roh-HTML; Read-Only-Anzeige → eigenes <div> mit prose-Styling und
                expandAbbreviations, weil TipTap unbekannte Tags (<abbr>) beim Parsen
                rauswirft. So bleiben die Tooltips garantiert erhalten.
                Drafts: für nicht-berechtigte User wird statt Content ein
                "wartet auf Freigabe"-Hinweis gezeigt. */}
            {(() => {
              const canEdit     = isAdmin || isGeschaeftsleitung || isZustaendigFor(activePage)
              const canSeeDraft = canEdit || isFreigabeFor(activePage)
              const isDraft     = activePage.status !== 'final'
              const editable    = canEdit && !previewMode

              // Draft-Page für jemanden ohne Bearbeitungs-/Freigabe-Recht
              if (isDraft && !canSeeDraft) {
                const heuteIso = new Date().toISOString().slice(0, 10)
                const wartetAufFreigabe = !!pageGueltigAb && pageGueltigAb >= heuteIso
                return (
                  <div className="flex-1 flex items-start justify-center overflow-auto px-6 py-10">
                    <div className="max-w-md w-full bg-amber-50 border-2 border-amber-200 rounded-2xl p-6 text-center">
                      <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-3">
                        <Clock className="w-6 h-6 text-amber-600" />
                      </div>
                      <h3 className="text-base font-semibold text-amber-900 mb-1">
                        {wartetAufFreigabe ? 'Wartet auf Freigabe' : 'In Bearbeitung'}
                      </h3>
                      <p className="text-sm text-amber-800 leading-snug mb-3">
                        Diese SOP-Seite ist noch nicht freigegeben und daher nicht
                        zur Anwendung bestimmt.
                      </p>
                      <div className="text-xs text-amber-700 space-y-0.5">
                        {pageZustaendig && (
                          <div><span className="font-semibold">Zuständig:</span> {pageZustaendig}</div>
                        )}
                        {pageFreigabeDurch && (
                          <div><span className="font-semibold">Freigabe durch:</span> {pageFreigabeDurch}</div>
                        )}
                        {pageGueltigAb && (
                          <div><span className="font-semibold">Geplant gültig ab:</span> {fmtDateStr(pageGueltigAb)}</div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              }

              if (editable) {
                return (
                  <div className="flex-1 overflow-hidden flex flex-col">
                    <RichTextEditor
                      key={`${activePageId}-edit`}
                      content={pageContent}
                      editable={true}
                      onChange={html => { setPageContent(html); setPageDirty(true) }}
                      placeholder="Inhalt hier eingeben…"
                      className="flex-1"
                    />
                  </div>
                )
              }
              return (
                <div
                  className="flex-1 overflow-auto px-6 py-5 prose prose-sm max-w-none prose-headings:text-gray-900 prose-table:text-sm prose-th:bg-gray-50 prose-td:align-top prose-a:text-primary-600"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: expandAbbreviations(pageContent, glossarMap) }}
                />
              )
            })()}

            {/* ── Relevant für + Schulungsnachweis Panels ── */}
            {activePage.status === 'final' || isAdmin || isGeschaeftsleitung ? (
              <div className="shrink-0 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">

                {/* Relevant für */}
                <div>
                  <button
                    onClick={() => setShowRelevantFuer(v => !v)}
                    className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                    <span className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-blue-500" />
                      Relevant für
                      <span className="text-xs font-normal text-gray-400">({pageRelevantFuer.length} Personen)</span>
                    </span>
                    {showRelevantFuer ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  </button>
                  {showRelevantFuer && (
                    <div className="px-5 pb-4 space-y-3">
                      {(isAdmin || isGeschaeftsleitung) && (() => {
                        // Gruppen-Definitionen — primäre + additionalRoles werden beide
                        // gezählt (so wie permGranted intern). Jede Gruppe bekommt zwei
                        // Quick-Aktionen: hinzufügen (alle Gruppen-Mitglieder zur Liste)
                        // und entfernen (alle aus der Liste raus).
                        const groups: Array<{ key: string; label: string; role: string }> = [
                          { key: 'arzt',              label: 'Ärzte',           role: 'arzt' },
                          { key: 'mpa',               label: 'MPAs',            role: 'mpa' },
                          { key: 'geschaeftsleitung', label: 'Geschäftsleitung', role: 'geschaeftsleitung' },
                          { key: 'admin',             label: 'Admins',          role: 'admin' },
                        ]
                        const allNames = sopUsers.map(u => u.displayName)
                        const allInList = allNames.length > 0 && allNames.every(n => pageRelevantFuer.includes(n))
                        return (
                          <div className="flex flex-wrap gap-1.5 pb-2 border-b border-gray-100">
                            <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide w-full mb-0.5">Schnellauswahl</span>
                            {groups.map(g => {
                              const groupMembers = sopUsers.filter(u => userHasRole(u, g.role)).map(u => u.displayName)
                              if (groupMembers.length === 0) return null
                              const allIncluded = groupMembers.every(n => pageRelevantFuer.includes(n))
                              return (
                                <button
                                  key={g.key}
                                  onClick={() => allIncluded ? removeFromRelevantFuer(groupMembers) : addToRelevantFuer(groupMembers)}
                                  title={`${groupMembers.length} ${g.label} ${allIncluded ? 'entfernen' : 'hinzufügen'}`}
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors
                                    ${allIncluded
                                      ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                                      : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}`}>
                                  {allIncluded ? '✓' : '+'} {g.label}
                                  <span className="opacity-70">({groupMembers.length})</span>
                                </button>
                              )
                            })}
                            <button
                              onClick={() => allInList ? replaceRelevantFuer([]) : replaceRelevantFuer(allNames)}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors
                                ${allInList
                                  ? 'bg-gray-600 text-white border-gray-600 hover:bg-gray-700'
                                  : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'}`}>
                              {allInList ? 'Alle abwählen' : 'Alle auswählen'}
                              <span className="opacity-70">({allNames.length})</span>
                            </button>
                          </div>
                        )
                      })()}
                      <div className="space-y-1.5">
                      {(isAdmin || isGeschaeftsleitung)
                        ? sopUsers.map(u => {
                            const checked = pageRelevantFuer.includes(u.displayName)
                            return (
                              <label key={u.uid} className="flex items-center gap-2.5 cursor-pointer group">
                                <input type="checkbox" checked={checked}
                                  onChange={() => handleToggleRelevantFuer(u.displayName)}
                                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-400 cursor-pointer" />
                                <span className="text-sm text-gray-700 group-hover:text-gray-900">{u.displayName}</span>
                                {u.role && (
                                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">{u.role}</span>
                                )}
                              </label>
                            )
                          })
                        : pageRelevantFuer.length === 0
                        ? <p className="text-sm text-gray-400">Keine Personen definiert</p>
                        : pageRelevantFuer.map(name => (
                            <div key={name} className="text-sm text-gray-700">{name}</div>
                          ))
                      }
                      </div>
                    </div>
                  )}
                </div>

                {/* Schulungsnachweis */}
                <div>
                  <button
                    onClick={() => setShowNachweis(v => !v)}
                    className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      Schulungsnachweis
                      <span className="text-xs font-normal text-gray-400">({pageViews.length}{pageRelevantFuer.length > 0 ? ` / ${pageRelevantFuer.length}` : ''} Bestätigungen)</span>
                    </span>
                    {showNachweis ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  </button>
                  {showNachweis && (
                    <div className="px-5 pb-4 space-y-3">
                      {/* Confirm button for current user if relevant */}
                      {isRelevantFuerPage && activePage.status === 'final' && (
                        hasConfirmed
                          ? <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                              <Check className="w-4 h-4" />
                              Bestätigt — Sie haben diese SOP gelesen und verstanden.
                            </div>
                          : <button onClick={handleConfirm} disabled={confirming}
                              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60">
                              {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                              Ich habe diese SOP gelesen und verstanden
                            </button>
                      )}
                      {isRelevantFuerPage && activePage.status !== 'final' && (
                        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          Bestätigung wird erst nach der Freigabe möglich.
                        </p>
                      )}
                      {/* List */}
                      {viewersLoading
                        ? <p className="text-xs text-gray-400">Lädt…</p>
                        : pageViews.length > 0
                        ? <ul className="divide-y divide-gray-100">
                            {pageViews.map(v => (
                              <li key={v.id} className="flex items-center justify-between py-2 text-xs">
                                <span className="font-medium text-gray-700">{v.displayName || v.username}</span>
                                <span className="text-gray-400">{fmtTs(v.viewedAt)}</span>
                              </li>
                            ))}
                          </ul>
                        : <p className="text-xs text-gray-400">Noch keine Bestätigungen</p>
                      }
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {/* ── Versionshistorie ── */}
            {(activePage.status === 'final' || isAdmin || isGeschaeftsleitung) ? (
              <div className="shrink-0 border-t border-gray-100">
                <button
                  onClick={() => setShowVersionen(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                  <span className="flex items-center gap-2">
                    <History className="w-4 h-4 text-purple-500" />
                    Versionshistorie
                    <span className="text-xs font-normal text-gray-400">
                      {versionsLoading ? '(lädt…)' : pageVersions.length > 0 ? `(${pageVersions.length} archivierte Version${pageVersions.length === 1 ? '' : 'en'})` : '(noch keine)'}
                    </span>
                  </span>
                  {showVersionen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                </button>
                {showVersionen && (
                  <div className="px-5 pb-4">
                    {versionsLoading ? (
                      <p className="text-xs text-gray-400">Lädt…</p>
                    ) : pageVersions.length === 0 ? (
                      <p className="text-xs text-gray-400">Noch keine archivierten Versionen. Bei der nächsten Freigabe wird der jetzige Stand archiviert.</p>
                    ) : (
                      <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                        {pageVersions.map(v => (
                          <li key={v.id}>
                            <button
                              onClick={() => { setOpenVersion(v); setVersionView('diff') }}
                              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition-colors text-left">
                              <span className="flex items-center gap-3 min-w-0">
                                <span className="text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded">
                                  v{v.version ?? '?'}
                                </span>
                                <span className="text-xs text-gray-500 tabular-nums">
                                  {fmtTs(v.snapshotAt)}
                                </span>
                                {v.freigabeDurch && (
                                  <span className="text-xs text-gray-400 truncate">freigegeben durch {v.freigabeDurch}</span>
                                )}
                              </span>
                              <span className="flex items-center gap-1 text-xs text-primary-600 shrink-0">
                                <GitCompare className="w-3.5 h-3.5" /> Vergleichen
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title={`${deleteTarget.type === 'section' ? 'Abschnitt' : deleteTarget.type === 'subsection' ? 'Unterabschnitt' : 'Seite'} löschen?`}
          message={`«${deleteTarget.item.title}» wird dauerhaft entfernt${deleteTarget.type !== 'page' ? ' (inkl. aller enthaltenen Inhalte)' : ''}.`}
          confirmLabel="Löschen"
          isLoading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {showExportPreview && activePage && (
        <SOPExportPreview
          page={{
            title:         activePage.title,
            content:       activePage.content || '',
            section:       activeSection?.title,
            subsection:    activeSubsection?.title,
            version:       activePage.version,
            zustaendig:    activePage.zustaendig,
            freigabeDurch: activePage.freigabeDurch,
            gueltigAb:     activePage.gueltigAb,
            status:        activePage.status,
            glossar:       glossarMap,
          }}
          onClose={() => setShowExportPreview(false)}
        />
      )}

      {/* Versions-Vergleichs-Modal */}
      {openVersion && activePage && (
        <SopVersionModal
          version={openVersion}
          currentContent={activePage.content ?? ''}
          currentTitle={activePage.title ?? ''}
          view={versionView}
          onViewChange={setVersionView}
          onClose={() => setOpenVersion(null)}
        />
      )}

      {/* Page-Verschieben-Modal */}
      {movingPage && (() => {
        const possibleSubsections = subsections.filter(s => s.sectionId === moveTargetSection)
        // Mögliche Parent-Pages = Top-Level-Pages der Ziel-Subsection (kein
        // parentPageId). Sich selbst + alle eigenen Sub-Pages ausschließen, damit
        // man keine Schleifen baut.
        const ownSubPageIds = new Set(allPages.filter(p => p.parentPageId === movingPage.id).map(p => p.id))
        const possibleParents = allPages.filter(p =>
          p.subsectionId === moveTargetSubsection
          && !p.parentPageId
          && p.id !== movingPage.id
          && !ownSubPageIds.has(p.id),
        )
        const currentSection = sections.find(s => s.id === movingPage.sectionId)
        const currentSubsec  = subsections.find(s => s.id === movingPage.subsectionId)
        return (
          <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => !moveSaving && setMovingPage(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <ArrowRightLeft className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="font-bold text-gray-900 truncate">«{movingPage.title}» verschieben</span>
                </div>
                <button onClick={() => setMovingPage(null)} disabled={moveSaving} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors shrink-0 disabled:opacity-40">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs text-gray-500">
                  Aktueller Standort: <span className="font-medium text-gray-700">{currentSection?.title ?? '?'}</span>
                  {' · '}<span className="text-gray-600">{currentSubsec?.title ?? '?'}</span>
                  {movingPage.parentPageId && (() => {
                    const parent = allPages.find(p => p.id === movingPage.parentPageId)
                    return <> · <span className="text-gray-600">Unterseite von «{parent?.title ?? '?'}»</span></>
                  })()}
                </p>

                <label className="block">
                  <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Section</span>
                  <select value={moveTargetSection}
                    onChange={e => { setMoveTargetSection(e.target.value); setMoveTargetSubsection(''); setMoveTargetParentPage('') }}
                    className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-400">
                    {sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Subsection</span>
                  <select value={moveTargetSubsection}
                    onChange={e => { setMoveTargetSubsection(e.target.value); setMoveTargetParentPage('') }}
                    className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-400">
                    <option value="">— wählen —</option>
                    {possibleSubsections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </label>

                {moveTargetSubsection && (
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Als …</span>
                    <select value={moveTargetParentPage}
                      onChange={e => setMoveTargetParentPage(e.target.value)}
                      className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-400">
                      <option value="">📄 Top-Level-Seite</option>
                      {possibleParents.map(p => (
                        <option key={p.id} value={p.id}>↳ Unterseite von «{p.title}»</option>
                      ))}
                    </select>
                  </label>
                )}

                {/* Hinweise */}
                {moveTargetSubsection && movingPage.subsectionId === moveTargetSubsection && movingPage.parentPageId === (moveTargetParentPage || undefined) && (
                  <p className="text-xs text-gray-400">Identisch zum aktuellen Standort — keine Änderung.</p>
                )}
                {ownSubPageIds.size > 0 && !movingPage.parentPageId && (
                  <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5">
                    {ownSubPageIds.size} Unterseite{ownSubPageIds.size === 1 ? '' : 'n'} wandert mit (bleibt {ownSubPageIds.size === 1 ? '' : 'bleiben'} verknüpft).
                  </p>
                )}
              </div>
              <div className="px-5 py-3 border-t border-gray-100 shrink-0 flex justify-end gap-2">
                <button onClick={() => setMovingPage(null)} disabled={moveSaving}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40">
                  Abbrechen
                </button>
                <button onClick={handleMoveSave}
                  disabled={moveSaving || !moveTargetSubsection
                    || (movingPage.subsectionId === moveTargetSubsection && (movingPage.parentPageId ?? '') === moveTargetParentPage)}
                  className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
                  {moveSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                  Verschieben
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Versions-Modal-Komponente ─────────────────────────────────────────────
function SopVersionModal({
  version, currentContent, currentTitle, view, onViewChange, onClose,
}: {
  version:         PageVersion
  currentContent:  string
  currentTitle:    string
  view:            'snapshot' | 'diff'
  onViewChange:    (v: 'snapshot' | 'diff') => void
  onClose:         () => void
}) {
  const diffParts: DiffPart[] = useMemo(
    () => diffSopContent(version.content ?? '', currentContent ?? ''),
    [version.content, currentContent],
  )
  const summary = useMemo(() => diffSummary(diffParts), [diffParts])
  const titleChanged = version.title !== currentTitle

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <History className="w-5 h-5 text-purple-500 shrink-0" />
            <span className="font-bold text-gray-900 truncate">
              Version v{version.version ?? '?'}
            </span>
            <span className="text-xs text-gray-400 shrink-0">archiviert {fmtTs(version.snapshotAt)}</span>
            {(summary.added > 0 || summary.removed > 0) && view === 'diff' && (
              <span className="text-xs font-medium shrink-0">
                {summary.added  > 0 && <span className="text-green-700">+{summary.added}</span>}
                {summary.added > 0 && summary.removed > 0 && <span className="text-gray-400"> / </span>}
                {summary.removed > 0 && <span className="text-red-700">−{summary.removed}</span>}
                <span className="text-gray-400"> Wörter</span>
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* View toggle */}
        <div className="px-5 py-2 border-b border-gray-100 shrink-0 flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            <button
              onClick={() => onViewChange('diff')}
              className={`px-3 py-1.5 transition-colors ${view === 'diff' ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              Vergleich zur aktuellen Version
            </button>
            <button
              onClick={() => onViewChange('snapshot')}
              className={`px-3 py-1.5 border-l border-gray-200 transition-colors ${view === 'snapshot' ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              Nur diese Version (Snapshot)
            </button>
          </div>
          {titleChanged && view === 'diff' && (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
              Titel geändert: «{version.title}» → «{currentTitle}»
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto px-6 py-5 bg-gray-50">
          {view === 'snapshot' ? (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-lg font-bold text-gray-900 mb-3">{version.title}</h3>
              <div
                className="tiptap-content prose prose-sm max-w-none"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: version.content ?? '' }}
              />
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <p className="text-xs text-gray-400 mb-3">
                <span className="inline-block px-1.5 py-0.5 rounded bg-green-100 text-green-800 mr-1">grün</span>
                = neu hinzugekommen.
                <span className="inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-700 line-through ml-2 mr-1">rot</span>
                = aus dieser Version entfernt.
              </p>
              <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {diffParts.map((p, i) => {
                  if (p.kind === 'added') {
                    return <span key={i} className="bg-green-100 text-green-900 rounded px-0.5">{p.text}</span>
                  }
                  if (p.kind === 'removed') {
                    return <span key={i} className="bg-red-50 text-red-700 line-through rounded px-0.5">{p.text}</span>
                  }
                  return <span key={i}>{p.text}</span>
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 shrink-0 flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Schliessen
          </button>
        </div>
      </div>
    </div>
  )
}
