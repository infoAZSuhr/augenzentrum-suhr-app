import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import BackButton from '../components/ui/BackButton'
import {
  BookOpen, Syringe, Package, CalendarDays, Users, Bell,
  User, LogIn, ArrowLeftRight, ChevronRight, Info, ArrowUp, LayoutList, Phone, GraduationCap, ClipboardList,
  CheckCircle2, AlertCircle, RefreshCw, Globe, Monitor, Loader2,
} from 'lucide-react'

function Section({ id, icon: Icon, title, children }: {
  id: string; icon: React.ElementType; title: string; children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="flex items-center gap-3 mb-5 pb-2 border-b-2 border-primary-100">
        <div className="p-2 bg-primary-50 rounded-lg shrink-0">
          <Icon className="w-5 h-5 text-primary-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
      </div>
      <div className="space-y-6 text-sm text-gray-700 leading-relaxed">
        {children}
      </div>
    </section>
  )
}

function Sub({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-20 space-y-2">
      <h3 className="font-bold text-gray-800 text-base border-l-4 border-primary-300 pl-3">{title}</h3>
      <div className="pl-4 space-y-2">{children}</div>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
      <p>{children}</p>
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5">
      <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
      <p className="text-xs text-blue-800">{children}</p>
    </div>
  )
}

function Badge({ label, color }: { label: string; color: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>{label}</span>
}

function CodeBadge({ code, label, color }: { code: string; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className={`w-10 text-center px-1.5 py-0.5 rounded text-xs font-bold shrink-0 ${color}`}>{code}</span>
      <span className="text-sm text-gray-700">{label}</span>
    </div>
  )
}

/**
 * VersionInfo — zeigt die installierte Electron-Huelle-Version und prueft
 * gegen GitHub Releases. Gibt klares Signal "aktuell" vs. "Update verfuegbar".
 *
 * - Im Browser: Web-App-Hinweis (Web-App ist immer aktuell, kein Update noetig)
 * - In Electron: Hülle-Version aus electronApp.version (preload) vs.
 *   https://api.github.com/repos/.../releases/latest
 */
function VersionInfo() {
  // Electron-API durchs preload exposed
  const electronApp = (typeof window !== 'undefined' ? (window as any).electronApp : null) as {
    version?: string;
    platform?: string;
    onUpdateProgress?: (cb: (p: any) => void) => () => void;
  } | null
  const isElectron  = !!electronApp
  const installed   = electronApp?.version ?? null

  type CheckState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ok'; latest: string }
    | { status: 'update'; latest: string }
    | { status: 'error'; msg: string }
  const [check, setCheck] = useState<CheckState>({ status: 'idle' })

  // Live-Updater-Fortschritt vom Main-Process abonnieren (nur Electron).
  type UpdaterStatus =
    | { state: 'checking' }
    | { state: 'available'; version?: string }
    | { state: 'not-available' }
    | { state: 'downloading'; percent: number; transferred: number; total: number }
    | { state: 'downloaded'; version?: string }
    | { state: 'error'; message?: string }
  const [updater, setUpdater] = useState<UpdaterStatus | null>(null)
  useEffect(() => {
    if (!electronApp?.onUpdateProgress) return
    return electronApp.onUpdateProgress(setUpdater)
  }, [electronApp])

  function formatMB(bytes?: number): string {
    if (!bytes) return '0 MB'
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  async function checkLatest() {
    setCheck({ status: 'loading' })
    try {
      // GitHub REST API — kein Auth noetig fuer public repos (60 req/h pro IP)
      const res = await fetch('https://api.github.com/repos/infoAZSuhr/augenzentrum-suhr-app/releases/latest')
      if (res.status === 404) {
        // Repo hat noch keinen veroeffentlichten Release — typisch wenn die
        // erste .exe noch nicht via Tag-Push gebaut wurde.
        setCheck({ status: 'error', msg: 'Noch kein Release veröffentlicht' })
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as { tag_name?: string }
      const latest = (json.tag_name ?? '').replace(/^v/, '')
      if (!latest) throw new Error('Kein Release gefunden')
      // Einfacher String-Vergleich reicht fuer SemVer-Tags (v1.0.2 < v1.1.0).
      // Genauer SemVer-Parser ist hier overkill — wir vergleichen Major/Minor/Patch
      // numerisch.
      const cmp = compareSemver(installed ?? '0.0.0', latest)
      setCheck(cmp < 0 ? { status: 'update', latest } : { status: 'ok', latest })
    } catch (e: any) {
      setCheck({ status: 'error', msg: e?.message ?? String(e) })
    }
  }

  // Auto-Check beim Mount (nur in Electron — Browser ist immer aktuell)
  useEffect(() => { if (isElectron) checkLatest() }, [isElectron]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
      <div className="flex items-center gap-2">
        {isElectron ? <Monitor className="w-4 h-4 text-gray-400" /> : <Globe className="w-4 h-4 text-gray-400" />}
        <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
          {isElectron ? 'Desktop-App' : 'Web-App'}
        </p>
      </div>

      {/* Installierte Version */}
      <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
        <span className="text-gray-500">Installierte Version</span>
        <span className="font-mono font-semibold text-gray-900">{installed ?? '—'}</span>
        {isElectron && (
          <>
            <span className="text-gray-500">Neueste verfügbare Version</span>
            <span className="font-mono text-gray-700">
              {check.status === 'loading'  && <span className="inline-flex items-center gap-1 text-gray-400"><Loader2 className="w-3 h-3 animate-spin" /> prüfe…</span>}
              {check.status === 'ok'       && check.latest}
              {check.status === 'update'   && check.latest}
              {check.status === 'error'    && <span className="text-red-500">Fehler: {check.msg}</span>}
              {check.status === 'idle'     && '—'}
            </span>
          </>
        )}
      </div>

      {/* Status-Badge */}
      {isElectron && check.status === 'ok' && (
        <div className="flex items-center gap-2 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-green-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>App ist auf dem neuesten Stand.</span>
        </div>
      )}
      {isElectron && check.status === 'update' && (
        <div className="flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Update auf <strong>v{check.latest}</strong> verfügbar — beim nächsten App-Neustart wird es automatisch eingespielt.</span>
        </div>
      )}

      {/* Live-Updater-Fortschritt vom Main-Process */}
      {isElectron && updater?.state === 'downloading' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-blue-800">
            <span className="font-semibold">Update wird heruntergeladen…</span>
            <span className="tabular-nums">{updater.percent}% — {formatMB(updater.transferred)} / {formatMB(updater.total)}</span>
          </div>
          <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${updater.percent}%` }} />
          </div>
        </div>
      )}
      {isElectron && updater?.state === 'downloaded' && (
        <div className="flex items-center gap-2 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-green-800">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Update <strong>v{updater.version}</strong> heruntergeladen — wird beim nächsten Neustart installiert.</span>
        </div>
      )}
      {isElectron && updater?.state === 'checking' && (
        <p className="text-xs text-gray-500 inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Suche nach Updates…</p>
      )}
      {isElectron && updater?.state === 'error' && (
        <p className="text-xs text-red-500">Updater-Fehler: {updater.message}</p>
      )}
      {!isElectron && (
        <div className="flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-blue-800">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Web-Version ist immer aktuell — sie wird direkt von unserem Server geladen.</span>
        </div>
      )}

      {/* Manuell prüfen */}
      {isElectron && (
        <button
          onClick={checkLatest}
          disabled={check.status === 'loading'}
          className="inline-flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${check.status === 'loading' ? 'animate-spin' : ''}`} /> erneut prüfen
        </button>
      )}

      {/* Copyright */}
      <div className="border-t border-gray-100 pt-3 mt-1 text-[11px] text-gray-400 space-y-0.5">
        <p>Version {installed ?? __APP_VERSION__} · © {new Date().getFullYear()} Augenzentrum Suhr AG</p>
        <p>Entwicklung: Saran Pasquale</p>
      </div>
    </div>
  )
}

/** Vergleicht zwei SemVer-Strings (ohne v-Prefix). Negativ = a < b, 0 = gleich, positiv = a > b. */
function compareSemver(a: string, b: string): number {
  const partsA = a.split('.').map(n => parseInt(n, 10) || 0)
  const partsB = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const d = (partsA[i] ?? 0) - (partsB[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export default function HelpPage() {
  const { hash } = useLocation()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (hash) {
      const el = document.querySelector(hash)
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    }
  }, [hash])

  return (
    <div ref={containerRef} className="p-4 sm:p-8 max-w-3xl mx-auto space-y-12 pb-24">

      {/* Back */}
      <div className="flex items-center">
        <BackButton />
      </div>

      {/* Header */}
      <div className="text-center space-y-2 pt-2">
        <div className="flex items-center justify-center gap-3 mb-2">
          <BookOpen className="w-8 h-8 text-primary-600" />
          <h1 className="text-3xl font-bold text-gray-900">Benutzerhandbuch</h1>
        </div>
        <p className="text-gray-500">Praxis-Management — Augenzentrum Suhr</p>
        <p className="text-sm text-gray-400">Diese Anleitung erklärt Schritt für Schritt, wie die App funktioniert.</p>
      </div>

      {/* Version-Status */}
      <VersionInfo />

      {/* TOC */}
      <div className="bg-gray-50 rounded-2xl p-5 border border-gray-200">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
          <ChevronRight className="w-3.5 h-3.5" /> Inhaltsverzeichnis
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4 text-sm">
          {([
            ['login',              '1. Anmelden & Login',           false],
            ['autologout',         'Auto-Logout',                   true],
            ['dashboard',          '2. Dashboard (Startseite)',      false],
            ['op',                 '3. OP-Bereich (IVI, Lid, KAT)', false],
            ['ivi-behandlung',     'IVI Neue Behandlung',           true],
            ['lager',              '4. Lager',                       false],
            ['lager-artikel',      'Artikel erfassen / bearbeiten',  true],
            ['lager-arzneimittel-db','CH-Arzneimittel-DB',           true],
            ['lager-preise',       'Preisberechnung',                true],
            ['planung',            '5. Einsatzplanung',              false],
            ['planung-arbeitstage','Arbeitstage-Ansicht',           true],
            ['planung-jahresfilter','Jahresansicht filtern',         true],
            ['mein-bereich',       '6. Mein Bereich',                false],
            ['absenheitsmeldung',  'Absenheitsmeldung',              true],
            ['einsaetze',          'Einsätze',                       true],
            ['abwesenheiten-tab',  'Abwesenheiten',                  true],
            ['antraege-tab',       'Anträge',                        true],
            ['antraege',           '7. Antragsstatus',               false],
            ['pinnwand',           '8. Pinnwand',                    false],
            ['benachrichtigungen', '9. Benachrichtigungen (Admin)',  false],
            ['benutzer',           '10. Benutzerverwaltung (Admin)', false],
            ['benutzer-arbeitszeit','Arbeitszeit (Ärzte)',           true],
            ['profil',             '11. Profil & Passwort',          false],
            ['aufgaben',           '12. Aufgaben',                   false],
            ['aufgaben-boards',    'Boards verwalten',               true],
            ['aufgaben-karten',    'Aufgabenkarten',                  true],
            ['sop',                '13. SOP',                        false],
            ['sop-lesen',          'Inhalte lesen',                  true],
            ['sop-freigabe',       'Freigabe-Workflow',              true],
            ['sop-bearbeiten',     'Inhalte bearbeiten',             true],
            ['sop-relevant',       'Relevant für & Schulungsnachweis', true],
            ['recall',              '14. Recall',                    false],
            ['recall-tabelle',      'Tabelle, Schnellaktionen & Filter', true],
            ['recall-patient',      'Patient erfassen / bearbeiten', true],
            ['recall-storno',       'Stornierung & Weiteres Vorgehen',true],
            ['recall-verlauf',      'Verlauf / Kontaktprotokoll',    true],
            ['recall-excel',         'Excel-Abgleich (Graufärbung)',   true],
            ['recall-zubearbeiten', 'Zu bearbeiten & Upload',        true],
            ['akv',                '15. AKV',                        false],
            ['akv-tabelle',        'Verantwortungsmatrix',           true],
            ['akv-bearbeiten',     'Aufgaben verwalten (Admin)',     true],
            ['akv-personen',       'Personen verwalten (Admin)',     true],
            ['akv-schulung',       'Relevant für & Schulungsnachweis', true],
            ['akv-freigabe',       'Freigabe & Drucken',            true],
            ['hilfe-modus',        '16. Hilfe-Modus',                false],
          ] as [string,string,boolean][]).map(([id, label, sub]) => (
            <button key={id}
              onClick={()=>document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'})}
              className={`flex items-center gap-1.5 hover:underline py-0.5 text-left ${sub ? 'pl-4 text-xs text-primary-500 hover:text-primary-700' : 'text-primary-600 hover:text-primary-800'}`}>
              <ChevronRight className={`shrink-0 ${sub ? 'w-2.5 h-2.5' : 'w-3 h-3'}`} />{label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── 1. LOGIN ─────────────────────────────────────────────────────── */}
      <Section id="login" icon={LogIn} title="1. Anmelden & Login">
        <p>
          Wenn Sie die App-Adresse im Browser öffnen, erscheint als Erstes die <strong>Login-Seite</strong>.
          Hier müssen Sie sich mit Ihren persönlichen Zugangsdaten anmelden, bevor Sie die App nutzen können.
        </p>

        <Sub title="So melden Sie sich an">
          <Step n={1}>Geben Sie Ihren <strong>Benutzernamen</strong> in das erste Feld ein. Den Benutzernamen hat Ihnen der Administrator mitgeteilt.</Step>
          <Step n={2}>Geben Sie Ihr <strong>Passwort</strong> in das zweite Feld ein. Mit dem Auge-Symbol rechts im Feld können Sie das Passwort ein- oder ausblenden.</Step>
          <Step n={3}>Klicken Sie auf den blauen Button <strong>«Anmelden»</strong>.</Step>
          <Step n={4}>Sie werden automatisch zur Startseite (Dashboard) weitergeleitet.</Step>
          <Tip>Achten Sie auf Gross- und Kleinschreibung bei Benutzername und Passwort.</Tip>
        </Sub>

        <Sub id="passwort-vergessen" title="Passwort vergessen">
          <p>Falls Sie Ihr Passwort nicht mehr kennen, können Sie eine Rücksetz-Anfrage an den Administrator stellen:</p>
          <Step n={1}>Klicken Sie unter dem Login-Formular auf den Link <strong>«Passwort vergessen»</strong>.</Step>
          <Step n={2}>Geben Sie Ihren Benutzernamen oder Ihre E-Mail-Adresse ein.</Step>
          <Step n={3}>Klicken Sie auf <strong>«Anfrage senden»</strong>.</Step>
          <Step n={4}>Der Administrator wird benachrichtigt und sendet Ihnen eine E-Mail mit einem Link zum Zurücksetzen des Passworts.</Step>
          <Tip>Der Reset-Link in der E-Mail ist nur für kurze Zeit gültig. Öffnen Sie ihn so bald wie möglich.</Tip>
        </Sub>

        <Sub id="autologout" title="Automatische Abmeldung">
          <p>Die App schützt Ihre Daten durch zwei automatische Abmeldungen:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Inaktivitäts-Logout:</strong> Nach <strong>10 Minuten ohne Aktivität</strong> (keine Mausbewegung, kein Klick, keine Eingabe) werden Sie automatisch abgemeldet und zur Login-Seite weitergeleitet.
            </li>
            <li>
              <strong>Browser-Logout:</strong> Wenn Sie das Browserfenster schliessen oder den Browser beenden, wird die Sitzung sofort beendet. Beim nächsten Öffnen müssen Sie sich erneut anmelden.
            </li>
          </ul>
          <Tip>Wenn die Aktivitäts-Zeit verstreicht, erscheint direkt die Login-Seite — speichern Sie daher alle offenen Eingaben regelmässig.</Tip>
        </Sub>

        <Sub id="admin-kontakt" title="Administrator kontaktieren (ohne Login)">
          <p>Falls Sie noch keinen Account haben oder aus einem anderen Grund Hilfe benötigen, können Sie den Administrator direkt kontaktieren — ohne eingeloggt zu sein:</p>
          <Step n={1}>Klicken Sie auf den Link <strong>«Administrator kontaktieren»</strong> unter dem Login-Formular.</Step>
          <Step n={2}>Geben Sie optional Ihren Namen ein.</Step>
          <Step n={3}>Wählen Sie Ihr <strong>Anliegen</strong> aus:
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              <li><strong>Loginanfrage</strong> — Sie möchten einen neuen Zugang erhalten</li>
              <li><strong>Passwort zurücksetzen</strong> — Sie können sich nicht einloggen</li>
              <li><strong>Andere</strong> — Für alle anderen Fragen (Freitext)</li>
            </ul>
          </Step>
          <Step n={4}>Klicken Sie auf <strong>«Senden»</strong>. Der Administrator sieht Ihre Nachricht in der Glocken-Benachrichtigung.</Step>
          <Tip>Aus Spam-Schutz ist maximal 1 Nachricht alle 10 Minuten möglich.</Tip>
        </Sub>
      </Section>

      {/* ─── 2. DASHBOARD ─────────────────────────────────────────────────── */}
      <Section id="dashboard" icon={CalendarDays} title="2. Dashboard (Startseite)">
        <p>
          Nach dem Login sehen Sie das <strong>Dashboard</strong> — die Startseite der App.
          Es gibt Ihnen auf einen Blick die wichtigsten Informationen des Tages.
        </p>

        <Sub title="Begrüssung">
          <p>Ganz oben sehen Sie eine persönliche Begrüssung mit Ihrem Vornamen und der aktuellen Tageszeit (Guten Morgen / Guten Tag / Guten Abend).</p>
        </Sub>

        <Sub title="Geplante IVI-Tage">
          <p>Diese Karte zeigt die nächsten Tage, an denen <strong>Intravitreale Injektionen (IVI)</strong> geplant sind. Für jeden Tag sehen Sie:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Das Datum und den Wochentag</li>
            <li>Wie viele Patienten an diesem Tag eingeplant sind</li>
            <li>Welche Ärzte an diesem Tag eingesetzt sind</li>
          </ul>
          <p>Mit dem Link <strong>«Alle →»</strong> rechts oben gelangen Sie direkt zur vollständigen IVI-Verwaltung. Das <strong>Drucker-Symbol 🖨</strong> im Karten-Header öffnet die druckbare Gesamtübersicht aller IVI-Tage.</p>
        </Sub>

        <Sub title="KAT-Tage (OP KSA)">
          <p>Diese Karte zeigt Tage, an denen Ärzte im <strong>Kantonsspital Aarau (KSA)</strong> für Kataraktoperationen eingeplant sind.</p>
          <p className="font-medium text-orange-700">Wichtig: An diesen Tagen sind die betreffenden Ärzte <u>nicht im Augenzentrum Suhr</u>.</p>
          <p>Pro Tag sehen Sie das Datum, den Wochentag und die Namen der abwesenden Ärzte mit dem Badge <Badge label="OP KSA" color="bg-purple-100 text-purple-700" />. Das <strong>Drucker-Symbol 🖨</strong> öffnet die druckbare KAT-Gesamtübersicht.</p>
        </Sub>

        <Sub title="Recall-Karte">
          <p>Zeigt auf einen Blick den Stand der Recall-Verwaltung:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Patienten (zugeordnet)</strong> — Gesamtzahl aller Arzt-Patienten</li>
            <li><strong>Zu bearbeiten</strong> — Noch nicht zugewiesene Patienten <Badge label="orange" color="bg-amber-100 text-amber-700" /></li>
            <li><strong>RC überfällig</strong> — RC-Datum bereits vergangen, Aufgebot noch nicht erstellt <Badge label="rot" color="bg-red-100 text-red-700" /></li>
            <li><strong>In Recall erstellt</strong> — Patienten mit «Im Recall»-Status</li>
            <li><strong>Reminder fällig</strong> — Patienten, bei denen ein geplanter Reminder heute oder in der Vergangenheit liegt <Badge label="lila" color="bg-purple-100 text-purple-700" /></li>
          </ul>
          <Tip>Sind keine Einträge in den Warn-Kategorien vorhanden, erscheint «Kein Handlungsbedarf».</Tip>
        </Sub>

        <Sub title="Lager-Warnungen">
          <p>Diese Karte zeigt auf einen Blick, wie viele <strong>Lager-Warnungen</strong> aktuell aktiv sind.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Grüner Hintergrund = alles in Ordnung</li>
            <li>Gelber Hintergrund = Warnungen vorhanden</li>
            <li>Roter Hintergrund = kritische Warnungen, sofort handeln</li>
          </ul>
          <p>Klicken Sie auf die Karte, um zum Lagerbereich zu gelangen.</p>
        </Sub>

        <Sub title="Einsatzplanung (Wochenübersicht)">
          <p>Darunter sehen Sie eine <strong>scrollbare Übersicht der Einsatzwochen</strong>. Jede Karte entspricht einer Kalenderwoche:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>KW 23</strong> = Kalenderwoche 23 (oben links in der Karte)</li>
            <li><strong>3/5 🩺</strong> = An 3 von 5 Wochentagen ist mindestens ein Arzt im Haus</li>
            <li>Das Datum-Intervall steht oben rechts (z.B. 02.06. – 06.06.2025)</li>
            <li>Ärzte werden <strong>fett und gross</strong> dargestellt, MPA klein und grau</li>
            <li>Feiertage haben einen <span className="bg-orange-50 text-orange-700 px-1 rounded">orangen Hintergrund</span></li>
            <li>Der heutige Tag hat einen <span className="bg-blue-50 text-blue-700 px-1 rounded">blauen Hintergrund</span></li>
          </ul>
          <p>Scrollen Sie horizontal um weitere Wochen zu sehen. Mit dem Button <strong>«+ 4 Wochen»</strong> am Ende laden Sie weitere Wochen nach.</p>
          <Tip>Die Einsatzcodes (GT, VM, NM, usw.) werden weiter unten im Kapitel «Einsatzplanung» erklärt.</Tip>
        </Sub>
      </Section>

      {/* ─── 3. OP ────────────────────────────────────────────────────────── */}
      <Section id="op" icon={Syringe} title="3. OP-Bereich (IVI, Lid, KAT)">
        <p>
          Über den <strong>«OP»-Button</strong> in der Navigationsleiste oben öffnet sich ein Dropdown-Menü mit drei Unterbereichen.
          Jeder Bereich verwaltet eine andere Art von Operationen oder Behandlungen.
        </p>

        <Sub title="IVI — Intravitreale Injektion">
          <p>Hier werden Patienten verwaltet, die regelmässige Injektionen ins Auge erhalten. Sie können:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Eine Liste aller IVI-Patienten einsehen</li>
            <li>Einen neuen Patienten erfassen</li>
            <li>Den nächsten Termin eines Patienten planen</li>
            <li>Die Behandlungshistorie einsehen</li>
          </ul>
        </Sub>

        <Sub id="ivi-behandlung" title="Neue IVI-Behandlung erfassen">
          <p>Beim Öffnen des Formulars «Neue Behandlung» erscheint ganz oben eine <strong>Patienteninformationsleiste</strong> mit:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Patienten-ID (Kürzel)</li>
            <li>Vor- und Nachname</li>
            <li>Geburtsdatum</li>
          </ul>
          <p className="mt-2">Im Abschnitt <strong>«Nächste IVI-Tage»</strong> werden automatisch die nächsten geeigneten Termine vorgeschlagen. Die App zeigt dabei nur Tage, an denen:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Dmitri</strong> anwesend ist (GT, VM oder NM im Plan)</li>
            <li><strong>Und</strong> mindestens <strong>Markus oder Stefan</strong> ebenfalls anwesend ist</li>
          </ul>
          <p>So ist sichergestellt, dass immer zwei Ärzte vor Ort sind.</p>
          <Tip>Wenn Sie mit der Maus über einen vorgeschlagenen Termin fahren, erscheint ein Tooltip mit der <strong>Anzahl Wochen</strong> ab dem aktuellen Behandlungsdatum — praktisch zur Intervallkontrolle.</Tip>
          <Tip>Falls keine passenden Tage mit zwei Ärzten gefunden werden (z.B. weil die Planung noch nicht erfasst ist), werden allgemeine IVI-Tage ohne Einschränkung angezeigt.</Tip>
        </Sub>

        <Sub title="Lid — Lidoperationen">
          <p>Verwaltung von Patienten, die einen Lideingriff benötigen oder erhalten haben.</p>
        </Sub>

        <Sub title="KAT — Kataraktoperationen">
          <p>Verwaltung von Patienten, die im KSA für eine Kataraktoperation eingeplant sind. Diese Patienten erscheinen automatisch als <strong>KAT-Tage</strong> im Dashboard.</p>
        </Sub>
      </Section>

      {/* ─── 4. LAGER ─────────────────────────────────────────────────────── */}
      <Section id="lager" icon={Package} title="4. Lager">
        <p>
          Im Lagerbereich verwalten Sie den <strong>Bestand an Medikamenten und Materialien</strong>.
          Die App warnt Sie automatisch, wenn ein Artikel nachbestellt werden muss, und bietet direkten Zugriff auf die schweizerische Arzneimitteldatenbank.
        </p>

        <Sub title="Lager-Warnungen verstehen">
          <p>Es gibt zwei Stufen von Warnungen:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <Badge label="Kritisch" color="bg-red-100 text-red-700" /> —
              Der Bestand ist <strong>unter das Minimum</strong> gefallen oder der Artikel ist abgelaufen.
              Sofortiger Handlungsbedarf.
            </li>
            <li>
              <Badge label="Warnung" color="bg-amber-100 text-amber-700" /> —
              Der Bestand wird bald knapp. Bitte bald nachbestellen.
            </li>
          </ul>
          <p className="mt-2">Die Bestandsangaben in den Warnungen (Dashboard und Lager) werden in der <strong>Mengeneinheit</strong> des jeweiligen Artikels angezeigt (z.B. «Tabletten», «ml», «Stück») — nicht in Packungseinheiten. So stimmt die Anzeige immer mit dem tatsächlichen Lagerbestand überein.</p>
        </Sub>

        <Sub id="lager-artikel" title="Artikel erfassen / bearbeiten">
          <p>Über <strong>«Neuer Artikel»</strong> oder den Bearbeiten-Button eines bestehenden Artikels öffnen Sie das Artikelformular. Die wichtigsten Felder:</p>

          <div className="bg-gray-50 rounded-xl p-3 border border-gray-200 space-y-2 mt-1">
            <p><strong>Artikelname *</strong> — Pflichtfeld. Rechts neben dem Label befindet sich der Button <Badge label="CH-Arzneimittel-DB" color="bg-blue-100 text-blue-700" />, mit dem Sie direkt in der Schweizer Arzneimitteldatenbank suchen können (siehe unten).</p>
            <p><strong>GTIN / EAN</strong> — Europäische Artikelnummer (13-stellig). Sobald Sie eine GTIN eingeben, prüft die App automatisch, ob dieser Artikel bereits im Lager vorhanden ist. Ist er bereits erfasst, erscheint eine rote Warnung und das Speichern ist blockiert — so werden Doppelerfassungen verhindert.</p>
            <p><strong>Kategorie</strong> — Wählen Sie die Produktkategorie. Über den Button <strong>«Verwalten»</strong> können neue Kategorien hinzugefügt oder bestehende gelöscht werden (analog zu Einheiten und Mengeneinheiten). Änderungen gelten sofort für alle Benutzer.</p>
            <p><strong>Behandlungsart</strong> — <strong>Mehrfachauswahl möglich.</strong> Klicken Sie auf einen oder mehrere Buttons (z.B. «IVI», «Lid», «KAT»). Aktive Auswahlen erscheinen hervorgehoben. Mit <strong>«Auswahl zurücksetzen»</strong> können Sie alle Auswahlen auf einmal entfernen. Artikel, die mehreren Behandlungsarten zugeordnet sind, erscheinen in der Medikamentenauswahl jeder zutreffenden Kategorie.</p>
          </div>

          <Tip>Die GTIN-Prüfung läuft automatisch im Hintergrund — Sie müssen nichts zusätzlich tun. Sobald eine Übereinstimmung gefunden wird, erscheint unter dem Feld «⚠ GTIN bereits vergeben: [Artikelname]» und der Speichern-Button ist deaktiviert.</Tip>
          <Tip>Neue Kategorien werden in Echtzeit für alle Benutzer sichtbar. Löschen Sie eine Kategorie nur, wenn sie nicht mehr benötigt wird — bestehende Artikel behalten die alte Kategorie als Text, auch wenn sie aus der Liste entfernt wurde.</Tip>
        </Sub>

        <Sub id="lager-arzneimittel-db" title="CH-Arzneimittel-DB — Schweizer Arzneimitteldatenbank">
          <p>Über den Button <Badge label="CH-Arzneimittel-DB" color="bg-blue-100 text-blue-700" /> neben dem Artikelnamen öffnet sich ein Suchpanel mit drei Tabs:</p>

          <div className="space-y-3 mt-1">
            <div className="bg-green-50 rounded-xl p-3 border border-green-200">
              <p className="font-semibold text-green-800 mb-1">Tab «CH-Arzneimittel» — SL &amp; Refdata kombiniert</p>
              <p className="text-sm">Durchsucht gleichzeitig zwei offizielle Schweizer Quellen nach Name, GTIN, Hersteller oder ATC-Code:</p>
              <ul className="list-disc pl-5 space-y-1 mt-1 text-sm">
                <li>
                  <Badge label="SL" color="bg-green-100 text-green-700" /> <strong>Spezialitätenliste (BAG)</strong> — Kassenpflichtige Medikamente (KVV). Zeigt den <em>Fabrikabgabepreis</em> (exkl. MWST) an. Nur Medikamente, für die eine Krankenkassenerstattung besteht, sind hier aufgeführt.
                </li>
                <li>
                  <Badge label="RD" color="bg-blue-100 text-blue-700" /> <strong>Refdata-Artikelstamm</strong> — Alle in der Schweiz zugelassenen Arzneimittel (Swissmedic-Zulassung). Zeigt den <em>Publikumspreis</em> (Apothekenpreis inkl. MWST) an. Artikel, die bereits in der SL gefunden wurden, werden hier nicht nochmals angezeigt.
                </li>
              </ul>
              <p className="text-sm mt-1.5">Klicken Sie auf einen Treffer, um <strong>Artikelname und GTIN</strong> automatisch in das Formular zu übernehmen. Der Preis wird <em>nicht</em> automatisch übernommen (SL zeigt Fabrikabgabepreis, RD zeigt Publikumspreis — beide unterscheiden sich vom internen Nettopreis).</p>
            </div>

            <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
              <p className="font-semibold text-gray-800 mb-1">Tab «Compendium» — Produktsuche via GTIN</p>
              <p className="text-sm">Öffnet eine direkte GTIN-/EAN-Suche im <strong>Compendium.ch</strong>. Die aktuell im Formular eingetragene GTIN wird automatisch in das Suchfeld eingesetzt.</p>
              <Step n={1}>Tragen Sie zuerst die GTIN im Artikelformular ein.</Step>
              <Step n={2}>Öffnen Sie den Tab «Compendium».</Step>
              <Step n={3}>Die GTIN ist bereits vorausgefüllt — klicken Sie auf <strong>«Im Compendium öffnen»</strong>, um das offizielle Produktdossier in einem neuen Browserfenster zu öffnen.</Step>
              <Tip>Compendium.ch enthält detaillierte Fachinformationen, Packungsbeilagen und Bilder zu jedem Schweizer Arzneimittel.</Tip>
            </div>
          </div>

          <p className="mt-2 text-xs text-gray-500">Die Daten der SL und des Refdata-Artikelstamms werden regelmässig (täglich, automatisch) aktualisiert. Bei Fragen zum Aktualitätsstand wenden Sie sich an die Praxisadministration.</p>
        </Sub>

        <Sub id="lager-preise" title="Preisberechnung">
          <p>Im Artikelformular können Sie einen <strong>Nettopreis</strong> (exkl. MWST, in CHF) erfassen. Die App berechnet daraus automatisch:</p>
          <div className="bg-gray-50 rounded-xl p-3 border border-gray-200 space-y-1 text-sm mt-1">
            <div className="flex justify-between">
              <span>Nettopreis (Eingabe)</span>
              <span className="font-mono">z.B. CHF 10.00</span>
            </div>
            <div className="flex justify-between">
              <span>+ MWST (2.6 % für Medikamente / Augentropfen, 8.1 % für Sonstiges)</span>
              <span className="font-mono text-gray-500">+ CHF 0.26</span>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-1">
              <span className="font-semibold">Bruttopreis</span>
              <span className="font-mono font-semibold">CHF 10.26</span>
            </div>
            <div className="flex justify-between text-primary-700">
              <span>Bruttopreis + 30 % Lagerkosten</span>
              <span className="font-mono">CHF 13.34</span>
            </div>
          </div>
          <Tip>Der Wert «+30 % Lagerkosten» ist ein Richtwert für die interne Kostenverrechnung. Der tatsächlich verrechnete Betrag kann abweichen.</Tip>
        </Sub>

        <Sub title="Bestand aktualisieren">
          <p>Achten Sie darauf, den Bestand nach jeder <strong>Lieferung</strong> (Eingang) oder <strong>Entnahme</strong> (Abgang) zu aktualisieren, damit die Warnungen korrekt funktionieren. Für jede Bewegung können Sie Lotnummer und Verfallsdatum erfassen — so behalten Sie den Überblick über ablaufende Chargen.</p>
        </Sub>
      </Section>

      {/* ─── 5. PLANUNG ───────────────────────────────────────────────────── */}
      <Section id="planung" icon={CalendarDays} title="5. Einsatzplanung">
        <p>
          Die Einsatzplanung zeigt, wer wann und wie arbeitet.
          Admins können die Planung direkt bearbeiten. Mitarbeiter können über «Mein Bereich» Anfragen stellen.
        </p>

        <Sub title="Ansichten wechseln">
          <p>Oben links in der Einsatzplanung können Sie zwischen drei Ansichten wählen:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Monat</strong> — Zeigt alle Tage des aktuellen Monats in einer Tabelle. Ideal für die tägliche Übersicht.</li>
            <li><strong>Jahr</strong> — Zeigt alle 12 Monate scrollbar untereinander. Ideal für die Gesamtübersicht und Langzeitplanung.</li>
            <li><strong>Arbeitstage</strong> — Zeigt die definierten Regelarbeitstage aller Ärzte in einer kompakten Wochenübersicht.</li>
          </ul>
        </Sub>

        <Sub title="Einsatzcodes — was bedeuten sie?">
          <p>Jeder Eintrag in der Planung hat einen farbigen <strong>Code</strong>, der die Art des Einsatzes beschreibt:</p>
          <div className="bg-gray-50 rounded-xl p-3 space-y-0.5 border border-gray-200">
            <CodeBadge code="GT"  label="Ganztag — Der Mitarbeiter ist den ganzen Tag anwesend"       color="bg-green-100 text-green-700" />
            <CodeBadge code="VM"  label="Vormittag — Der Mitarbeiter ist nur am Vormittag da"          color="bg-blue-100 text-blue-700" />
            <CodeBadge code="NM"  label="Nachmittag — Der Mitarbeiter ist nur am Nachmittag da"        color="bg-indigo-100 text-indigo-700" />
            <CodeBadge code="OP"  label="OP KSA — Der Arzt operiert im Kantonsspital Aarau (nicht im Haus)" color="bg-purple-100 text-purple-700" />
            <CodeBadge code="W"   label="Weiterbildung — Fortbildung oder Kurs (nicht im Haus)"       color="bg-amber-100 text-amber-700" />
            <CodeBadge code="NFD" label="Notfalldienst — Der Mitarbeiter hat Notfalldienst"            color="bg-red-100 text-red-700" />
            <CodeBadge code="Fer" label="Ferien — Der Mitarbeiter ist in den Ferien"                   color="bg-sky-100 text-sky-700" />
            <CodeBadge code="K"   label="Krank — Der Mitarbeiter ist krankgeschrieben"                 color="bg-rose-100 text-rose-700" />
            <CodeBadge code="A"   label="Abwesend — Der Mitarbeiter ist aus einem anderen Grund absent" color="bg-gray-100 text-gray-600" />
            <CodeBadge code="Ad"  label="Administrativ — Administrative Aufgaben ausserhalb der Praxis" color="bg-teal-100 text-teal-700" />
            <CodeBadge code="AG"  label="Ausgleich — Ausgleichstag für Überstunden oder Dienste"      color="bg-orange-100 text-orange-700" />
            <CodeBadge code="T"   label="Telefondienst — Der Mitarbeiter ist im Telefondienst"          color="bg-teal-100 text-teal-700" />
          </div>
        </Sub>

        <Sub id="planung-arbeitstage" title="Arbeitstage-Ansicht">
          <p>Die Ansicht <strong>«Arbeitstage»</strong> zeigt die regulären Wochentage aller Ärzte auf einen Blick — ohne auf einen konkreten Monat oder ein Jahr eingehen zu müssen.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Für jeden Arzt / jede Ärztin wird angezeigt, an welchen Wochentagen (Mo–Sa) und zu welchen Zeiten (von/bis) er oder sie regulär arbeitet.</li>
            <li>Die Zeiten werden direkt in der Benutzerverwaltung gepflegt (Admin/GL).</li>
          </ul>
          <Tip>Diese Ansicht dient als Nachschlagewerk für Regelarbeitszeiten und hat keinen Einfluss auf die eigentliche Einsatzplanung.</Tip>
        </Sub>

        <Sub id="planung-jahresfilter" title="Jahresansicht — nach Person filtern">
          <p>In der <strong>Jahresansicht</strong> können Sie die Anzeige auf eine einzelne Person einschränken:</p>
          <Step n={1}>Öffnen Sie die Jahresansicht über den Button <strong>«Jahr»</strong> oben links.</Step>
          <Step n={2}>Oben rechts erscheint ein Dropdown. Wählen Sie eine bestimmte Person aus der Liste, um nur deren Einträge anzuzeigen.</Step>
          <Step n={3}>Wählen Sie <strong>«Alle»</strong>, um wieder alle Personen gleichzeitig zu sehen.</Step>
          <Tip>Der Filter gilt je Abschnitt (Ärzte / MPA) und wird automatisch zurückgesetzt, wenn Sie eine andere Ansicht (Monat / Arbeitstage) wählen.</Tip>
        </Sub>

        <Sub title="Eintrag bearbeiten">
          <p><strong>Administratoren</strong> können Einträge direkt bearbeiten. <strong>Geschäftsleitungs-Benutzer (GL)</strong> können ihre eigenen Arbeitstage ebenfalls direkt eintragen — ohne Genehmigung durch den Admin.</p>
          <Step n={1}>Klicken Sie in der Monatsansicht auf eine Zelle in der Tabelle (Schnittpunkt von Person und Datum).</Step>
          <Step n={2}>Es erscheint eine Auswahl der verfügbaren Codes.</Step>
          <Step n={3}>Klicken Sie auf den gewünschten Code. Der Eintrag wird sofort gespeichert.</Step>
          <Step n={4}>Um einen Eintrag zu löschen, klicken Sie erneut auf den bereits ausgewählten Code.</Step>
          <Tip>Änderungen werden automatisch in der Cloud gespeichert — kein «Speichern»-Button nötig.</Tip>
          <Tip>Mitarbeiter ohne Admin-/GL-Rechte stellen über «Mein Bereich» einen Antrag, der vom Admin genehmigt werden muss.</Tip>
        </Sub>

        <Sub id="feiertage" title="Feiertage verwalten (nur Admin)">
          <Step n={1}>Klicken Sie auf den Button <strong>«Feiertage»</strong> in der Toolbar.</Step>
          <Step n={2}>Geben Sie das Datum und den Namen des Feiertags ein.</Step>
          <Step n={3}>Klicken Sie auf <strong>«Hinzufügen»</strong>. Der Feiertag erscheint sofort in der Planung und im Dashboard (orange hervorgehoben).</Step>
          <Step n={4}>Um einen Feiertag zu entfernen, klicken Sie auf das Papierkorb-Symbol neben dem Eintrag.</Step>
        </Sub>

        <Sub title="Person umbenennen (nur Admin)">
          <p>Wenn ein Mitarbeiter in der Planung falsch benannt ist, kann der Name direkt in der Tabelle korrigiert werden:</p>
          <Step n={1}>Bewegen Sie die Maus über den Namen in der Spaltenüberschrift.</Step>
          <Step n={2}>Klicken Sie auf das <strong>Stift-Symbol</strong>, das erscheint.</Step>
          <Step n={3}>Wählen Sie den richtigen Benutzernamen aus der Dropdown-Liste.</Step>
          <Step n={4}>Klicken Sie auf das Häkchen zum Bestätigen.</Step>
        </Sub>

        <Sub title="Drucken">
          <Step n={1}>Klicken Sie auf den <strong>«Drucken»-Button</strong> in der Toolbar.</Step>
          <Step n={2}>Wählen Sie ob Sie den aktuellen Monat oder das gesamte Jahr drucken möchten.</Step>
          <Step n={3}>Es öffnet sich ein Druckfenster. Die Seite wird automatisch auf DIN A4 Querformat skaliert.</Step>
          <Tip>Stellen Sie in den Druckeinstellungen «Querformat» ein, falls es nicht automatisch gesetzt wird.</Tip>
        </Sub>
      </Section>

      {/* ─── 6. MEIN BEREICH ──────────────────────────────────────────────── */}
      <Section id="mein-bereich" icon={User} title="6. Mein Bereich">
        <p>
          Der persönliche Bereich ist für alle Mitarbeiter zugänglich. Sie können ihn auf zwei Wegen öffnen:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Klicken Sie in der Einsatzplanung auf den Button <strong>«Mein Bereich»</strong> oben rechts in der Toolbar.</li>
          <li>Machen Sie einen <strong>Doppelklick auf Ihre eigene Zelle</strong> in der Planungstabelle — das Fenster öffnet sich direkt beim passenden Reiter.</li>
        </ul>
        <p>
          Der Bereich hat vier Reiter: <strong>Absenheitsmeldung</strong>, <strong>Einsätze</strong>, <strong>Abwesenheiten</strong> und <strong>Anträge</strong>.
        </p>

        <Sub id="absenheitsmeldung" title="Reiter: Absenheitsmeldung">
          <p>Hier stellen Sie eine Anfrage für Ferien, Weiterbildung, Ausgleich oder andere Abwesenheiten:</p>
          <Step n={1}>Wählen Sie die <strong>Art der Abwesenheit</strong> aus dem Dropdown (Ferien, Weiterbildung, Ausgleich, Militär/Zivildienst, Abwesend).</Step>
          <Step n={2}>Wählen Sie das <strong>Von-Datum</strong> (erster Abwesenheitstag).</Step>
          <Step n={3}>Wählen Sie das <strong>Bis-Datum</strong> (letzter Abwesenheitstag).</Step>
          <Step n={4}>Geben Sie optional eine <strong>Bemerkung</strong> ein.</Step>
          <Step n={5}>Klicken Sie auf <strong>«Antrag stellen»</strong>.</Step>
          <Step n={6}>Nach dem Einreichen wechselt die Ansicht automatisch zum Reiter «Abwesenheiten», wo Sie den Status verfolgen können.</Step>
          <Tip>Stellen Sie Abwesenheitsanfragen so früh wie möglich, damit der Admin die Planung rechtzeitig anpassen kann.</Tip>
          <Tip>Wenn der Administrator eine Anpassung verlangt, erscheint ein Hinweis mit Alternativdaten direkt im Formular — klicken Sie darauf, um die Daten zu übernehmen.</Tip>
        </Sub>

        <Sub id="einsaetze" title="Reiter: Einsätze">
          <p>Hier sehen Sie alle Ihre zukünftigen Einsätze (<Badge label="GT" color="bg-green-100 text-green-700" />, <Badge label="VM" color="bg-blue-100 text-blue-700" />, <Badge label="NM" color="bg-yellow-100 text-yellow-700" />, <Badge label="NFD" color="bg-red-100 text-red-700" />, <Badge label="Ad" color="bg-amber-100 text-amber-700" />). Neben jedem Einsatz gibt es zwei Buttons:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>⇄ Tauschen</strong> — Tauschantrag mit Wunschdatum oder direkt mit einem Kollegen stellen</li>
            <li><strong>✎ Ändern</strong> — Änderung oder Absage des Einsatzes beantragen</li>
          </ul>

          <p className="font-semibold mt-3" id="tausch">Einsatz tauschen</p>
          <p><strong>Option 1 — Wunschdatum:</strong> Sie geben ein Wunschdatum an, der Admin wählt den Tauschpartner.</p>
          <Step n={1}>Klicken Sie auf <strong>«⇄ Tauschen»</strong> und wählen Sie den Reiter <strong>«Wunschdatum»</strong>.</Step>
          <Step n={2}>Wählen Sie das gewünschte neue Datum.</Step>
          <Step n={3}>Klicken Sie auf <strong>«Tausch beantragen»</strong>.</Step>

          <p className="font-semibold mt-2"><strong>Option 2 — Mit Mitarbeiter:</strong> Sie tauschen direkt mit einem Kollegen.</p>
          <Step n={1}>Klicken Sie auf <strong>«⇄ Tauschen»</strong> und wählen Sie den Reiter <strong>«Mit Mitarbeiter»</strong>.</Step>
          <Step n={2}>Wählen Sie den Kollegen und dessen Datum aus.</Step>
          <Step n={3}>Klicken Sie auf <strong>«Tausch beantragen»</strong>. Bei Genehmigung werden beide Einträge automatisch getauscht.</Step>
          <Tip>Solange ein Tausch offen ist, erscheint «Tausch ausstehend» anstelle des Tauschen-Buttons.</Tip>

          <p className="font-semibold mt-3" id="aenderung">Einsatz ändern oder absagen</p>
          <Step n={1}>Klicken Sie auf <strong>«✎ Ändern»</strong> beim betreffenden Einsatz.</Step>
          <Step n={2}>Wählen Sie optional einen neuen Code (z.B. <Badge label="K" color="bg-rose-100 text-rose-700" /> für Krank). Leer lassen = vollständige Absage.</Step>
          <Step n={3}>Geben Sie optional eine Begründung ein und klicken Sie auf <strong>«Anfrage senden»</strong>.</Step>

          <p className="font-semibold mt-3">Einsatz anfragen</p>
          <p>Über den Button <strong>«+ Einsatz anfragen»</strong> können Sie einen neuen Einsatztag beantragen, der noch nicht in der Planung steht.</p>

          <p className="font-semibold mt-3">Archiv</p>
          <p>Vergangene Einsätze werden im einklappbaren <strong>Archiv</strong> am Ende der Liste angezeigt.</p>
        </Sub>

        <Sub id="abwesenheiten-tab" title="Reiter: Abwesenheiten">
          <p>Hier sehen Sie alle Ihre zukünftigen Abwesenheitstage (<Badge label="OP" color="bg-zinc-100 text-zinc-600" />, <Badge label="W" color="bg-stone-200 text-stone-700" />, <Badge label="Fer" color="bg-slate-200 text-slate-600" />, <Badge label="K" color="bg-gray-300 text-gray-700" />, <Badge label="A" color="bg-gray-400 text-gray-900" />, <Badge label="AG" color="bg-neutral-200 text-neutral-600" />).</p>
          <p>Pro Tag sehen Sie den Code, die Art der Abwesenheit und den Status des zugehörigen Antrags (falls vorhanden). Abwesenheiten, die der Admin direkt eingetragen hat, erscheinen mit dem Badge <Badge label="Im Plan" color="bg-gray-100 text-gray-500" />.</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li><strong>✎ Ändern</strong> — Öffnet das Antragsformular, um eine Änderung zu beantragen (bei Anträgen).</li>
            <li><strong>✕ Stornieren</strong> — Zieht einen offenen Antrag zurück und entfernt die Einträge aus dem Plan.</li>
            <li><strong>✎ Änderungsantrag stellen</strong> — Bei direkt eingetragenen Abwesenheiten ohne Antrag können Sie eine neue Anfrage stellen.</li>
          </ul>
          <Tip>Vergangene Abwesenheiten werden im einklappbaren Archiv am Ende der Liste angezeigt.</Tip>
        </Sub>

        <Sub id="antraege-tab" title="Reiter: Anträge">
          <p>Hier sehen Sie alle Ihre bisherigen Anfragen — Abwesenheiten, Tausche, Änderungen und Einsatzanfragen — als ausführliche Karten.</p>
          <p>Jede Karte zeigt: Art des Antrags, Details (Datum, Code, Zeitraum), wer ihn wann bearbeitet hat und eine allfällige Admin-Notiz.</p>
          <Tip>Genehmigte Anträge, deren Datum in der Vergangenheit liegt, werden automatisch ausgeblendet. Die Anzahl ausgeblendeter Anträge wird am Ende angezeigt.</Tip>
          <Tip>Wenn ein Antrag den Status «Anpassung nötig» hat, erscheint der Button <strong>«✏️ Antrag anpassen»</strong> direkt bei der Karte.</Tip>
        </Sub>
      </Section>

      {/* ─── 7. ANTRÄGE ───────────────────────────────────────────────────── */}
      <Section id="antraege" icon={Bell} title="7. Antragsstatus">
        <p>
          Jeder Antrag durchläuft einen Statuswechsel. Den aktuellen Status sehen Sie jederzeit im Reiter <strong>«Anträge»</strong> im Mein Bereich sowie in der <strong>Glocken-Benachrichtigung</strong>.
        </p>

        <Sub title="Status-Übersicht">
          <div className="space-y-2.5">
            <div className="flex items-start gap-3">
              <Badge label="⏳ Ausstehend" color="bg-blue-50 text-blue-700 border border-blue-200" />
              <p>Der Antrag wurde eingereicht und wartet auf Bearbeitung durch den Administrator.</p>
            </div>
            <div className="flex items-start gap-3">
              <Badge label="✓ Genehmigt" color="bg-green-50 text-green-700 border border-green-200" />
              <p>Der Antrag wurde genehmigt. Die Einsatzplanung wurde automatisch aktualisiert.</p>
            </div>
            <div className="flex items-start gap-3">
              <Badge label="◑ Provisorisch" color="bg-yellow-50 text-yellow-700 border border-yellow-300" />
              <p>Vorläufig genehmigt — die endgültige Bestätigung folgt noch.</p>
            </div>
            <div className="flex items-start gap-3">
              <Badge label="✕ Abgelehnt" color="bg-red-50 text-red-600 border border-red-200" />
              <p>Der Antrag wurde abgelehnt. Die Planung bleibt unverändert.</p>
            </div>
            <div className="flex items-start gap-3">
              <Badge label="↩ Anpassung nötig" color="bg-orange-50 text-orange-700 border border-orange-200" />
              <p>Der Administrator hat den Antrag zurückgeschickt. Lesen Sie die Admin-Notiz und passen Sie den Antrag über den Button <strong>«✏️ Antrag anpassen»</strong> an.</p>
            </div>
            <div className="flex items-start gap-3">
              <Badge label="↩ Storniert" color="bg-gray-100 text-gray-500 border border-gray-300" />
              <p>Sie haben den Antrag selbst zurückgezogen.</p>
            </div>
          </div>
        </Sub>

        <Sub title="Was passiert bei Genehmigung?">
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Abwesenheitsantrag genehmigt</strong> — Die Tage werden in der Planung entsprechend eingetragen.</li>
            <li><strong>Tausch genehmigt</strong> — Die Einträge beider Personen werden automatisch getauscht.</li>
            <li><strong>Wunschdatum genehmigt</strong> — Ihr Eintrag wird auf das neue Datum verschoben.</li>
            <li><strong>Änderung genehmigt</strong> — Der Code wird automatisch auf den neuen Wert gesetzt.</li>
            <li><strong>Absage genehmigt</strong> — Ihr Eintrag wird automatisch aus der Planung gelöscht.</li>
          </ul>
        </Sub>

        <Sub title="Benachrichtigung in der Glocke">
          <p>Wenn der Administrator Ihren Antrag bearbeitet, erscheint eine Benachrichtigung im <strong>Glocken-Symbol</strong> oben rechts. Die Zahl auf der Glocke zeigt die Anzahl ungelesener Benachrichtigungen.</p>
          <p>Mit dem <strong>X-Button</strong> bei einer Benachrichtigung wird diese nur aus der Glocke entfernt — der Antrag bleibt im Reiter «Anträge» unter Mein Bereich weiterhin sichtbar.</p>
        </Sub>
      </Section>

      {/* ─── 8. PINNWAND ─────────────────────────────────────────────────────── */}
      <Section id="pinnwand" icon={Bell} title="8. Pinnwand">
        <p>
          Die <strong>Pinnwand</strong> ist das digitale schwarze Brett der Praxis. Mitteilungen können nach <strong>Zielgruppe</strong> gefiltert werden — jeder Benutzer sieht nur die Boards, für die er berechtigt ist.
        </p>

        <Sub title="Boards (Tafeln)">
          <p>Oben auf der Pinnwand sehen Sie Tabs für jedes Board. Ein Badge zeigt die Anzahl ungelesener Mitteilungen:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Alle</strong> — Für alle Mitarbeitenden sichtbar</li>
            <li><strong>MPA</strong> — Nur für MPA sichtbar</li>
            <li><strong>Arzt</strong> — Nur für Ärzte sichtbar</li>
            <li><strong>GL</strong> — Nur für Geschäftsleitung sichtbar</li>
            <li><strong>Admin</strong> — Nur für Administratoren sichtbar</li>
          </ul>
          <Tip>Benutzer sehen immer das Board «Alle» sowie die Boards ihrer eigenen Rolle(n). Admins sehen alle fünf Boards.</Tip>
        </Sub>

        <Sub title="Mitteilung lesen & bestätigen">
          <Step n={1}>Öffnen Sie die Pinnwand über die Navigation.</Step>
          <Step n={2}>Klicken Sie auf eine Mitteilung, um sie zu öffnen und als <strong>gelesen</strong> zu markieren.</Step>
          <Step n={3}>Mit dem <strong>Pin-Symbol 📌</strong> können Sie eine Mitteilung anheften — sie bleibt dann oben in der Liste.</Step>
          <Step n={4}>Über <strong>«Als ungelesen markieren»</strong> können Sie eine Mitteilung zurücksetzen, damit sie wieder als neu erscheint.</Step>
        </Sub>

        <Sub title="Neue Mitteilung erstellen (Admin / GL)">
          <Step n={1}>Klicken Sie auf <strong>«+ Neue Mitteilung»</strong>.</Step>
          <Step n={2}>Wählen Sie die <strong>Zielgruppe</strong> (welches Board).</Step>
          <Step n={3}>Wählen Sie den <strong>Typ</strong>: <Badge label="Info" color="bg-blue-100 text-blue-700" /> / <Badge label="Warnung" color="bg-amber-100 text-amber-700" /> / <Badge label="Wichtig" color="bg-red-100 text-red-700" />.</Step>
          <Step n={4}>Tragen Sie Titel und Text ein. Optional: PDF-Anhang hochladen.</Step>
          <Step n={5}>Klicken Sie auf <strong>«Veröffentlichen»</strong>. Alle berechtigten Benutzer erhalten sofort eine Toast-Benachrichtigung.</Step>
        </Sub>

        <Sub title="Toast-Benachrichtigungen">
          <p>Wenn eine neue Mitteilung für Ihren Board erscheint, während Sie die App geöffnet haben, erscheint rechts unten automatisch ein <strong>Toast</strong> (Einblend-Karte) mit dem Titel und Inhalt der Mitteilung. Er verschwindet nach 7 Sekunden oder durch Klick auf das ×.</p>
        </Sub>
      </Section>

      {/* ─── 9. BENACHRICHTIGUNGEN ────────────────────────────────────────── */}
      <Section id="benachrichtigungen" icon={Bell} title="9. Benachrichtigungen (Admin)">
        <p>
          Das <strong>Glocken-Symbol</strong> oben rechts zeigt eingegangene Benachrichtigungen. Für Mitarbeiter sind das Statusänderungen eigener Anträge; für Administratoren zusätzlich alle eingehenden Anfragen.
        </p>

        <Sub title="Benachrichtigungen öffnen">
          <Step n={1}>Klicken Sie auf das Glocken-Symbol oben rechts.</Step>
          <Step n={2}>Es öffnet sich ein Panel mit allen ausstehenden Anfragen, aufgeteilt in vier Abschnitte.</Step>
        </Sub>

        <Sub title="Neue Registrierungen">
          <p>Wenn sich ein neuer Benutzer registriert hat, erscheint er hier. Sie sehen Name, E-Mail und gewünschte Rolle.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Klicken Sie auf das <strong>grüne Häkchen (✓)</strong> um den Benutzer freizugeben. Der Benutzer kann sich danach einloggen.</li>
            <li>Klicken Sie auf das <strong>rote X</strong> um den Benutzer abzulehnen.</li>
          </ul>
        </Sub>

        <Sub title="Planungsanträge">
          <p>Hier erscheinen alle Ferien-, Tausch-, Änderungs- und Absageanträge der Mitarbeiter. Pro Antrag sehen Sie den Namen, die Art des Antrags und die Details.</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>✓ Genehmigen</strong> — Der Antrag wird genehmigt und die Planung automatisch aktualisiert.
            </li>
            <li>
              <strong>↩ Anpassung anfordern</strong> — Klicken Sie auf den orangen Button, geben Sie einen Hinweis ein und klicken Sie «Senden». Der Mitarbeiter sieht Ihre Notiz und kann eine neue Anfrage stellen.
            </li>
            <li>
              <strong>✗ Ablehnen</strong> — Der Antrag wird abgelehnt, die Planung bleibt unverändert.
            </li>
          </ul>
        </Sub>

        <Sub title="Passwort vergessen">
          <p>Wenn ein Benutzer über die Login-Seite ein Passwort-Reset beantragt hat, erscheint die Anfrage hier mit der E-Mail-Adresse des Benutzers.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Klicken Sie auf das <strong>Mail-Symbol</strong> um eine Reset-E-Mail an den Benutzer zu senden.</li>
            <li>Klicken Sie auf das <strong>rote X</strong> um die Anfrage abzulehnen.</li>
          </ul>
          <Tip>Der Benutzer erhält eine E-Mail mit einem Link. Dieser Link ist zeitlich begrenzt gültig.</Tip>
        </Sub>

        <Sub title="Nachrichten">
          <p>Kontaktanfragen, die über das Kontaktformular auf der Login-Seite gesendet wurden, erscheinen hier. Sie sehen das Anliegen, den Namen (falls angegeben) und die Nachricht.</p>
          <p>Klicken Sie auf das <strong>grüne Häkchen (✓)</strong> um die Nachricht als erledigt zu markieren. Sie verschwindet dann aus der Liste.</p>
        </Sub>
      </Section>

      {/* ─── 9. BENUTZERVERWALTUNG ────────────────────────────────────────── */}
      <Section id="benutzer" icon={Users} title="10. Benutzerverwaltung (Admin / GL)">
        <p>
          Die Benutzerverwaltung ist über den <strong>«Benutzer»-Link</strong> in der Navigationsleiste erreichbar.
          Hier verwalten Administratoren und Geschäftsleitungs-Benutzer alle Benutzerkonten der App.
        </p>

        <Sub title="Benutzer hinzufügen">
          <Step n={1}>Klicken Sie oben rechts auf <strong>«+ Benutzer hinzufügen»</strong>.</Step>
          <Step n={2}>Füllen Sie das Formular aus:
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              <li><strong>Vor- und Nachname</strong> — Der vollständige Name (wird in der Einsatzplanung verwendet)</li>
              <li><strong>Benutzername</strong> — Kürzel für den Login (z.B. «muster.m»)</li>
              <li><strong>E-Mail-Adresse</strong> — Wird für Passwort-Resets benötigt</li>
              <li><strong>Passwort</strong> — Mindestens 6 Zeichen</li>
              <li><strong>Rolle</strong> — Bestimmt die Berechtigungen (siehe unten)</li>
            </ul>
          </Step>
          <Step n={3}>Klicken Sie auf <strong>«Benutzer erstellen»</strong>.</Step>
          <Tip>Neu erstellte Benutzer werden beim ersten Login aufgefordert, ihr Passwort sofort zu ändern.</Tip>
        </Sub>

        <Sub title="Benutzerrollen">
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <Badge label="Admin" color="bg-red-100 text-red-700" />
              <p>Vollzugriff auf alle Bereiche. Kann Planung bearbeiten, Benutzer verwalten, Anträge bearbeiten und weitere Admins erstellen. Admins können von anderen Admins oder der Geschäftsleitung erstellt werden.</p>
            </div>
            <div className="flex items-start gap-3">
              <Badge label="Geschäftsleitung" color="bg-violet-100 text-violet-700" />
              <p>Erweiterte Rechte: Kann eigene Einsätze direkt in die Planung eintragen (ohne Antrag), Arbeitszeiten der Ärzte pflegen und weitere Admins erstellen. Sieht alle Boards und Karten.</p>
            </div>
            <div className="flex items-start gap-3">
              <Badge label="Arzt/Ärztin" color="bg-blue-100 text-blue-700" />
              <p>Kann alle Bereiche sehen und eigene Anträge stellen. Erscheint in der Ärztesektion der Planung.</p>
            </div>
            <div className="flex items-start gap-3">
              <Badge label="MPA" color="bg-green-100 text-green-700" />
              <p>Kann alle Bereiche sehen und eigene Anträge stellen. Erscheint in der MPA-Sektion der Planung.</p>
            </div>
            <div className="flex items-start gap-3">
              <Badge label="Gast" color="bg-gray-100 text-gray-600" />
              <p>Eingeschränkter Zugriff, nur lesend. Keine Antragsstellung möglich.</p>
            </div>
          </div>
        </Sub>

        <Sub id="benutzer-arbeitszeit" title="Arbeitszeit für Ärzte definieren (Admin / GL)">
          <p>Für jeden Benutzer mit der Rolle <strong>Arzt/Ärztin</strong> können die regulären Arbeitszeiten direkt in der Benutzerverwaltung hinterlegt werden.</p>
          <Step n={1}>Klicken Sie in der Benutzerliste auf das <strong>Uhr-Symbol</strong> rechts neben dem Arzt-Eintrag. (Das Symbol erscheint nur bei Ärzten und nur für Admins/GL.)</Step>
          <Step n={2}>Es klappt eine Zeile auf, in der Sie für jeden Wochentag (Mo–Sa) die Arbeitszeit festlegen können.</Step>
          <Step n={3}>Aktivieren Sie einen Tag mit dem Häkchen und geben Sie <strong>«Von»</strong> und <strong>«Bis»</strong>-Uhrzeit ein.</Step>
          <Step n={4}>Klicken Sie auf <strong>«Speichern»</strong>.</Step>
          <Tip>Die hinterlegten Arbeitszeiten erscheinen in der <strong>Arbeitstage-Ansicht</strong> der Einsatzplanung und dienen als Orientierung für die Personalplanung.</Tip>
        </Sub>

        <Sub title="Benutzer bearbeiten">
          <Step n={1}>Klicken Sie auf das <strong>Stift-Symbol</strong> rechts neben dem Benutzer.</Step>
          <Step n={2}>Ändern Sie Name, Benutzername, E-Mail-Adresse oder Rolle nach Bedarf.</Step>
          <Step n={3}>Klicken Sie auf <strong>«Speichern»</strong>.</Step>
          <Tip>Wenn der <strong>Name</strong> eines Benutzers geändert wird, aktualisiert die App den Namen automatisch überall — in Aufgabenkarten, Kommentaren, Planungsanträgen und der Einsatzplanung. Dieser Vorgang läuft im Hintergrund und ist in der Regel nach wenigen Sekunden abgeschlossen.</Tip>
          <Tip>Der Name (Vor- und Nachname) muss exakt mit dem Namen in der Einsatzplanung übereinstimmen, damit der Benutzer seine eigenen Einsätze unter «Mein Bereich» sieht.</Tip>
          <Tip>Die E-Mail-Adresse kann nachträglich im Bearbeitungsdialog eingetragen oder geändert werden — auch wenn sie beim Erstellen leer gelassen wurde.</Tip>
        </Sub>

        <Sub title="Passwort zurücksetzen">
          <Step n={1}>Klicken Sie auf das <strong>Schlüssel-Symbol</strong> neben dem Benutzer.</Step>
          <Step n={2}>Der Benutzer erhält automatisch eine E-Mail mit einem Reset-Link.</Step>
        </Sub>
      </Section>

      {/* ─── 10. PROFIL ───────────────────────────────────────────────────── */}
      <Section id="profil" icon={User} title="11. Profil & Passwort">
        <p>
          Über das <strong>Benutzermenü oben rechts</strong> (Ihr Name) gelangen Sie zu Ihrem persönlichen Profil.
        </p>

        <Sub title="Profil öffnen">
          <Step n={1}>Klicken Sie oben rechts auf Ihren Namen.</Step>
          <Step n={2}>Klicken Sie auf <strong>«Mein Profil»</strong>.</Step>
        </Sub>

        <Sub title="Passwort ändern">
          <Step n={1}>Öffnen Sie Ihr Profil wie oben beschrieben.</Step>
          <Step n={2}>Geben Sie Ihr <strong>aktuelles Passwort</strong> ein.</Step>
          <Step n={3}>Geben Sie das <strong>neue Passwort</strong> ein (mindestens 8 Zeichen).</Step>
          <Step n={4}>Wiederholen Sie das neue Passwort zur Bestätigung.</Step>
          <Step n={5}>Klicken Sie auf <strong>«Passwort ändern»</strong>.</Step>
          <Tip>Wählen Sie ein sicheres Passwort mit Gross- und Kleinbuchstaben, Zahlen und Sonderzeichen.</Tip>
        </Sub>

        <Sub title="Abmelden">
          <p>Klicken Sie oben rechts auf Ihren Namen und dann auf <strong>«Abmelden»</strong>. Sie werden zur Login-Seite weitergeleitet.</p>
          <Tip>Melden Sie sich immer ab, wenn Sie einen gemeinsam genutzten Computer verwenden.</Tip>
        </Sub>
      </Section>

      {/* ─── 11. AUFGABEN ─────────────────────────────────────────────────── */}
      <Section id="aufgaben" icon={LayoutList} title="12. Aufgaben">
        <p>
          Im Bereich <strong>Aufgaben</strong> können Boards erstellt und Aufgabenkarten verwaltet werden.
          Jedes Board ist wie eine Pinnwand mit Spalten, in denen Karten verschoben werden können.
        </p>

        <Sub id="aufgaben-boards" title="Boards verwalten">
          <p>Auf der Übersichtsseite sehen Sie alle Boards, auf die Sie Zugriff haben.</p>

          <p className="font-semibold mt-3">Neues Board erstellen</p>
          <Step n={1}>Klicken Sie oben rechts auf <strong>«+ Neues Board»</strong>.</Step>
          <Step n={2}>Geben Sie einen <strong>Namen</strong> und optional eine Beschreibung ein.</Step>
          <Step n={3}>Wählen Sie eine <strong>Farbe</strong> für das Board.</Step>
          <Step n={4}>Legen Sie die <strong>Sichtbarkeit</strong> fest:
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              <li><strong>Nur ich</strong> — Nur der Ersteller sieht dieses Board (Standard)</li>
              <li><strong>Bestimmte Person</strong> — Sie wählen eine Person aus; nur diese Person und Sie können das Board sehen</li>
              <li><strong>Alle</strong> — Alle Benutzer können das Board sehen</li>
              <li><strong>MPA</strong> — Nur MPA-Benutzer (und Admin/GL) sehen das Board</li>
              <li><strong>Ärzte</strong> — Nur Ärzte (und Admin/GL) sehen das Board</li>
              <li><strong>Nur GL/Admin</strong> — Nur Geschäftsleitung und Administratoren sehen das Board</li>
            </ul>
          </Step>
          <Step n={5}>Definieren Sie die <strong>Spalten</strong> (z.B. «Offen», «In Bearbeitung», «Erledigt»). Neue Spalten mit dem +-Button hinzufügen, vorhandene mit dem ×-Button entfernen.</Step>
          <Step n={6}>Klicken Sie auf <strong>«Speichern»</strong>.</Step>
          <Tip>Die Sichtbarkeit «Nur ich» ist voreingestellt. Passen Sie sie an, wenn das Board für andere bestimmt ist.</Tip>

          <p className="font-semibold mt-3">Board bearbeiten oder löschen</p>
          <p>Fahren Sie mit der Maus über ein Board. Es erscheinen das <strong>Zahnrad-Symbol</strong> (Bearbeiten) und das <strong>Papierkorb-Symbol</strong> (Löschen).</p>
          <Tip>Boards können nur vom Ersteller oder von Administratoren bearbeitet und gelöscht werden.</Tip>
        </Sub>

        <Sub id="aufgaben-karten" title="Aufgabenkarten">
          <p>Klicken Sie auf ein Board, um die Detailansicht mit allen Spalten und Karten zu öffnen.</p>

          <p className="font-semibold mt-3">Neue Karte erstellen</p>
          <Step n={1}>Klicken Sie in einer Spalte auf <strong>«+ Karte»</strong>.</Step>
          <Step n={2}>Geben Sie einen Titel ein und bestätigen Sie mit Enter oder dem +-Button.</Step>
          <Step n={3}>Klicken Sie auf die neue Karte, um sie zu öffnen und weitere Details zu ergänzen.</Step>

          <p className="font-semibold mt-3">Karte bearbeiten</p>
          <p>Klicken Sie auf eine Karte, um sie zu öffnen. Sie können folgende Felder bearbeiten — alle Änderungen werden <strong>automatisch gespeichert</strong>:</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li><strong>Titel</strong> — Name der Aufgabe</li>
            <li><strong>Beschreibung</strong> — Freitext mit Details</li>
            <li><strong>Fälligkeitsdatum</strong> — Geplantes Erledigungsdatum</li>
            <li><strong>Label</strong> — Kategorie (z.B. Dringend, Wichtig, Info, Normal). Nur ein Label gleichzeitig wählbar.</li>
            <li><strong>Zuweisung</strong> — Wem die Aufgabe zugewiesen ist (Person, Gruppe oder «Für mich»)</li>
            <li><strong>Checkliste</strong> — Teilaufgaben mit Abhak-Funktion. Über «+ Punkt hinzufügen» neue Einträge ergänzen.</li>
            <li><strong>Mitglieder</strong> — Weitere Personen, die an der Aufgabe beteiligt sind. Sie erhalten Benachrichtigungen bei Kommentaren.</li>
            <li><strong>Anhänge</strong> — Dateien hochladen. Klicken Sie auf einen Anhang, um ihn als Vorschau zu öffnen.</li>
            <li><strong>Kommentare</strong> — Nachrichten zu der Karte. Alle Beteiligten (Ersteller, Zugewiesene, Mitglieder) werden benachrichtigt.</li>
            <li><strong>Erledigt</strong> — Karte als abgeschlossen markieren.</li>
          </ul>

          <p className="font-semibold mt-3">Karte verschieben</p>
          <p>Ziehen Sie eine Karte per <strong>Drag &amp; Drop</strong> in eine andere Spalte oder Position.</p>

          <p className="font-semibold mt-3">Sichtbarkeit von Karten (automatischer Filter)</p>
          <p>Administratoren und Geschäftsleitung sehen alle Karten in einem Board. Alle anderen Benutzer sehen nur:</p>
          <ul className="list-disc pl-5 space-y-0.5 mt-1">
            <li>Karten ohne Zuweisung</li>
            <li>Karten, die ihrer Gruppe zugewiesen sind</li>
            <li>Karten, die ihnen persönlich zugewiesen sind</li>
          </ul>

          <p className="font-semibold mt-3">Benachrichtigungen</p>
          <p>Sie erhalten eine Benachrichtigung in der <strong>Glocke</strong>, wenn:</p>
          <ul className="list-disc pl-5 space-y-0.5 mt-1">
            <li>Ihnen eine Karte zugewiesen wird</li>
            <li>Jemand einen Kommentar zu einer Karte schreibt, bei der Sie Ersteller, Zugewiesene/r oder Mitglied sind</li>
          </ul>
          <p>Klicken Sie in der Benachrichtigung auf <strong>«Öffnen»</strong>, um direkt zur betreffenden Karte zu springen.</p>
        </Sub>
      </Section>

      {/* ─── 12. SOP ─────────────────────────────────────────────────────── */}
      <Section id="sop" icon={GraduationCap} title="13. SOP">
        <p>
          Der Bereich <strong>SOP</strong> (Standard Operating Procedures) enthält alle verbindlichen
          Arbeitsanweisungen des Augenzentrums Suhr — von Voruntersuchungen und Gerätebedienung bis
          zu Hygiene, Datenschutz und Administration. Die SOPs sind <strong>gelenkte Dokumente</strong>:
          jede Seite durchläuft einen Entwurfs- und Freigabe-Prozess mit Versionierung.
        </p>

        <Sub id="sop-lesen" title="Inhalte lesen">
          <p>Die Inhalte sind in einer <strong>dreistufigen Baumstruktur</strong> organisiert:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Abschnitte</strong> (farbig) — Hauptthemen, z.B. «Medizinische Abläufe»</li>
            <li><strong>Unterabschnitte</strong> — Themengruppen, z.B. «Glaukomkontrollen»</li>
            <li><strong>Seiten</strong> — Einzelne SOPs, z.B. «OCT – Makula & Disc»</li>
          </ul>
          <Step n={1}>Klicken Sie in der linken Seitenleiste auf einen <strong>Abschnitt</strong>, um ihn aufzuklappen.</Step>
          <Step n={2}>Klicken Sie auf einen <strong>Unterabschnitt</strong>, um die enthaltenen Seiten anzuzeigen.</Step>
          <Step n={3}>Klicken Sie auf eine <strong>Seite</strong>, um den Inhalt rechts anzuzeigen.</Step>
          <Tip>Nur <Badge label="Freigegeben" color="bg-green-100 text-green-700" />-Seiten sind für alle Benutzer sichtbar. Entwürfe sehen nur Zuständige, Freigabe-Personen und Admin/GL.</Tip>
        </Sub>

        <Sub id="sop-freigabe" title="Freigabe-Workflow (4-Augen-Prinzip)">
          <p>Jede SOP-Seite hat zwei Rollen — <strong>Zuständig</strong> (erstellt/bearbeitet) und <strong>Freigabe</strong> (prüft/genehmigt). Beide Personen müssen unterschiedlich sein.</p>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse w-full mt-2">
              <thead><tr className="bg-gray-100"><th className="text-left px-3 py-1.5 font-semibold">Rolle</th><th className="text-left px-3 py-1.5 font-semibold">Darf</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                <tr><td className="px-3 py-1.5 font-medium">Zuständig</td><td className="px-3 py-1.5">Titel und Inhalt bearbeiten, Version setzen</td></tr>
                <tr><td className="px-3 py-1.5 font-medium">Freigabe</td><td className="px-3 py-1.5">«Gültig ab»-Datum setzen und Seite freigeben</td></tr>
                <tr><td className="px-3 py-1.5 font-medium">Admin / GL</td><td className="px-3 py-1.5">Alles — auch «Zurück zu Entwurf»</td></tr>
              </tbody>
            </table>
          </div>
          <p className="font-semibold mt-3">Entwurf → Freigabe</p>
          <Step n={1}>Die <strong>Zuständige Person</strong> bearbeitet Inhalt und speichert. Der gelbe Entwurf-Banner bleibt sichtbar.</Step>
          <Step n={2}>Die <strong>Freigabe-Person</strong> prüft den Inhalt, setzt das <strong>«Gültig ab»</strong>-Datum und klickt auf <strong>«Freigeben»</strong>.</Step>
          <Step n={3}>Die Seite erhält den Status <Badge label="Freigegeben" color="bg-green-100 text-green-700" />, die Version wird um +0.1 erhöht und die Seite ist für alle sichtbar.</Step>
          <Tip>Die Zuständige Person kann die Freigabe nicht selbst erteilen — das 4-Augen-Prinzip ist technisch erzwungen.</Tip>
          <p className="font-semibold mt-3">Versioning</p>
          <p>Alle Seiten starten bei <strong>Version 1.0</strong>. Bei jeder Freigabe wird die Version automatisch um <strong>0.1</strong> erhöht (1.0 → 1.1 → 1.2 …). Die Version ist oben rechts auf jeder Seite sichtbar.</p>
          <p className="font-semibold mt-3">Zurück zu Entwurf</p>
          <p>Admin und GL können eine freigegebene Seite über den Button <strong>«Zurück zu Entwurf»</strong> (oben rechts) wieder in den Entwurf-Status versetzen. Dabei wird der Schulungsnachweis automatisch auf 0 zurückgesetzt.</p>
        </Sub>

        <Sub id="sop-bearbeiten" title="Inhalte bearbeiten (Admin/GL/Zuständig)">
          <p className="font-semibold">Neue Struktur anlegen (Admin/GL)</p>
          <Step n={1}>Klicken Sie oben in der Seitenleiste auf <strong>«+»</strong> (Abschnitt), <strong>«+ Unterabschnitt»</strong> oder <strong>«+ Seite»</strong>.</Step>
          <Step n={2}>Geben Sie den Namen ein und bestätigen Sie mit Enter.</Step>
          <Step n={3}>Abschnitte erhalten eine Farbe — diese erscheint als farbiger Balken neben dem Inhalt.</Step>

          <p className="font-semibold mt-3">Inhalt bearbeiten (Zuständige Person)</p>
          <p>Der <strong>Rich-Text-Editor</strong> unterstützt Überschriften, Fett/Kursiv, Listen, Ausrichtung, Trennlinie und Flussdiagramme. Änderungen werden nach 2 Sekunden automatisch gespeichert.</p>

          <p className="font-semibold mt-3">Umbenennen & Löschen</p>
          <p>Fahren Sie über einen Eintrag in der Seitenleiste — <strong>Stift</strong> (Umbenennen) und <strong>Papierkorb</strong> (Löschen) erscheinen. Das Löschen eines Abschnitts entfernt alle enthaltenen Einträge.</p>
        </Sub>

        <Sub id="sop-relevant" title="Relevant für & Schulungsnachweis">
          <p>Unterhalb jedes freigegebenen SOP-Inhalts befinden sich zwei ausklappbare Panels:</p>
          <p className="font-semibold mt-2">Relevant für</p>
          <p>Admin/GL können mit Checkboxen festlegen, welche Mitarbeitenden diese SOP kennen und bestätigen müssen. Andere Benutzer sehen die Liste nur.</p>
          <p className="font-semibold mt-2">Schulungsnachweis</p>
          <p>Benutzer, die unter «Relevant für» eingetragen sind, sehen nach der Freigabe einen blauen Button:</p>
          <p className="italic text-blue-700 pl-4">«Ich habe diese SOP gelesen und verstanden»</p>
          <p>Nach dem Klick erscheint ein grüner Haken. Admins und GL sehen die vollständige Liste aller Bestätigungen mit Datum.</p>
          <p>Der Zähler im Metadata-Header (z.B. <strong>3 / 5</strong>) zeigt auf einen Blick, wie viele der relevanten Personen bereits bestätigt haben.</p>
          <Tip>Bei jeder neuen Freigabe und beim «Zurück zu Entwurf» werden alle Bestätigungen zurückgesetzt — alle müssen die neue Version erneut bestätigen.</Tip>
        </Sub>
      </Section>

      {/* ─── 13. RECALL ──────────────────────────────────────────────────── */}
      <Section id="recall" icon={Phone} title="14. Recall">
        <p>
          Der <strong>Recall</strong>-Bereich dient der Verwaltung von Patienten, die periodisch
          zurückbestellt werden müssen (z.B. für Nachkontrollen oder erneute Behandlungen).
          Jeder Arzt hat einen eigenen Tab mit seiner Patientenliste. Ärzte ohne Gastzugang haben Zugriff auf alle Tabs.
        </p>

        <Sub title="Navigation & Tabs">
          <p>Oben in der Recall-Seite sehen Sie eine Registerleiste mit einem Tab pro Arzt sowie dem Tab
            <strong> «Zu bearbeiten»</strong> für noch nicht zugeordnete Patienten.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Klicken Sie auf einen Arzt-Tab, um dessen Patientenliste anzuzeigen.</li>
            <li>Die Zahl im Badge zeigt die Anzahl Patienten in diesem Tab.</li>
            <li>Der Tab <span className="text-amber-700 font-semibold">«Zu bearbeiten»</span> (orange) enthält Patienten aus der importierten Patientenliste, die noch keinem Arzt zugewiesen wurden.</li>
          </ul>
        </Sub>

        <Sub id="recall-tabelle" title="Tabelle & Filter">
          <p>Die Tabelle zeigt alle Patienten des aktiven Tabs. Die wichtigsten Spalten:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>PID</strong> — Patienten-ID aus dem KIM-System (mit #-Präfix)</li>
            <li><strong>Vorname</strong> — Name des Patienten. Mögliche Badges:
              <ul className="list-disc pl-5 mt-0.5 space-y-0.5">
                <li><Badge label="Neu" color="bg-emerald-100 text-emerald-700" /> — neu erfasster Patient (7 Tage sichtbar)</li>
                <li><Badge label="⏳ Patient anrufen" color="bg-amber-100 text-amber-700 border border-amber-300" /> — offene Kontaktaufgabe</li>
                <li><Badge label="🔔 2. Reminder" color="bg-orange-100 text-orange-700 border border-orange-300" /> — 6 Monate seit letztem Reminder ohne Rückmeldung; RC-Datum wird automatisch um 6 Monate verlängert</li>
              </ul>
            </li>
            <li><strong>Geb. Datum</strong> — Geburtsdatum</li>
            <li><strong>Letzte / Nächste Konst.</strong> — Datum im Format <strong>TT.MM.JJJJ</strong>. «Im Recall» bedeutet: Termin als Recall markiert, kein Datum vergeben.</li>
            <li><strong>RC erstellen ab</strong> — Ab wann das Aufgebot erstellt werden soll (Format <strong>TT.MM.JJJJ</strong>). Wird automatisch berechnet (siehe unten). Mit grünem «erstellt»-Badge, sobald das Aufgebot versandt wurde.</li>
            <li><strong>Aufgebotsart</strong> — Art des Aufgebots: Brief, Reminder, Tel. oder Praxis. Direkt in der Tabelle klickbar (ohne Dialog öffnen).</li>
            <li><strong>Storniert</strong> — Zeigt «ja» mit rotem Badge. Hover über den Badge zeigt den Stornierungsgrund.</li>
          </ul>
          <Tip>Inaktive und verstorbene Patienten werden standardmässig ausgeblendet. Sie können über den Status-Filter «Inaktiv / ✝» eingeblendet werden.</Tip>

          <p className="font-semibold mt-3">Automatische Berechnung «RC erstellen ab»</p>
          <p>Beim Eintragen von <strong>Letzter Konst.</strong>, <strong>Intervall</strong> oder <strong>Nächster Konst.</strong> berechnet die App das Datum «RC erstellen ab» automatisch:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Normalfall: <strong>Nächste Konst. − 2 Monate</strong></li>
            <li>Sonderfall: Liegt die Nächste Konst. weniger als 2 Monate nach der Letzten Konst. (oder in der Vergangenheit), wird <strong>«RC erstellen ab = heute»</strong> gesetzt.</li>
          </ul>

          <p className="font-semibold mt-3">Suche</p>
          <p>Das Suchfeld oben links durchsucht <strong>alle Ärzte gleichzeitig</strong> (ab 2 Zeichen Eingabe):</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Suche nach <strong>Name</strong>, <strong>PID</strong> (mit oder ohne #), <strong>Geburtsdatum</strong> oder Datum des Aufgebots</li>
            <li>Treffer aus allen Tabs erscheinen in der Tabelle; unter jedem Namen wird ein blauer Arzt-Badge angezeigt</li>
            <li>Klick auf einen Treffer öffnet direkt den Bearbeitungsdialog</li>
            <li>ESC oder × löscht die Suche und zeigt wieder den aktiven Tab</li>
          </ul>
          <Tip>Die PID-Suche erkennt «#1234» und «1234» als identisch — führende Nullen und #-Zeichen werden ignoriert.</Tip>

          <p className="font-semibold mt-3">Sortierung</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Klicken Sie auf einen Spaltentitel, um nach dieser Spalte zu sortieren (auf-/absteigend).</li>
            <li>Mit Shift+Klick können Sie nach mehreren Spalten gleichzeitig sortieren.</li>
          </ul>

          <p className="font-semibold mt-3">Schnellaktionen (Hover)</p>
          <p>Wenn Sie in der Desktop-Tabelle mit der Maus über eine Zeile fahren, erscheinen in der Spalte <strong>«Schnellaktionen»</strong> vier Icon-Buttons für häufige Aktionen — <strong>ohne den Bearbeitungsdialog öffnen zu müssen</strong>:</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li><strong>📞 Grün — Tel: Erreicht</strong> — Trägt sofort einen erfolgreichen Telefonanruf im Verlauf ein</li>
            <li><strong>📵 Orange — Tel: Nicht erreicht</strong> — Trägt einen nicht erreichten Anruf ein</li>
            <li><strong>🕐 Lila — Reminder in 1 Monat</strong> — Plant automatisch einen Reminder für heute + 1 Monat</li>
            <li><strong>✗ Rot — No Show</strong> — Storniert den Patienten sofort mit Grund «no Show»</li>
          </ul>
          <p className="mt-2">Zusätzlich erscheint links in der Schnellaktionen-Spalte ein <strong>grünes Tabellen-Symbol 🗃</strong>, sobald ein Patient mit Excel abgeglichen wurde (d.h. in der App gespeichert und die Excel-Liste entsprechend gefärbt).</p>
          <Tip>Alle Schnellaktionen wirken sofort (optimistisches Update) — die Tabelle aktualisiert sich ohne Neuladen. Schnellaktionen setzen den Excel-Abgleich <em>nicht</em> neu.</Tip>

          <p className="font-semibold mt-3">Filterleiste</p>
          <p>Unterhalb der Suche befindet sich eine kompakte Filterleiste:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Schnellfilter-Chips</strong> (direkt anklickbar):
              <ul className="list-disc pl-5 mt-0.5 space-y-0.5">
                <li><Badge label="Überfällig" color="bg-red-50 text-red-700 border border-red-200" /> — RC-Datum in der Vergangenheit, Aufgebot noch nicht erstellt</li>
                <li><Badge label="Geplante Recalls" color="bg-amber-50 text-amber-700 border border-amber-200" /> — Patienten mit «Im Recall»-Status oder gesetztem RC-Datum (Aufgebot noch nicht erstellt)</li>
                <li><Badge label="Ohne Termin" color="bg-gray-100 text-gray-600 border border-gray-300" /> — Patienten ohne Nächste Konst. <strong>und</strong> ohne RC-Datum — wirklich offen</li>
                <li><Badge label="🔔 Reminder fällig" color="bg-purple-100 text-purple-700 border border-purple-200" /> — Patienten, bei denen ein geplanter Reminder heute oder früher liegt (erscheint nur wenn vorhanden)</li>
              </ul>
            </li>
            <li>
              <strong>Zeitraum-Dropdown</strong> — Zeigt nur Patienten, bei denen «Nächste Konst.» im gewählten Zeitraum liegt:
              «Heute», «Nächste 7 Tage», «Nächste 30 Tage»
            </li>
            <li>
              <strong>Status-Dropdown</strong> — Zusatzfilter:
              <ul className="list-disc pl-5 mt-0.5 space-y-0.5">
                <li><strong>Neupatienten</strong> — Nur neu erfasste Patienten</li>
                <li><strong>⏳ Noch zu erledigen</strong> — Patienten mit offenen Kontaktaufgaben (Tel/E-Mail noch nicht abgeschlossen)</li>
                <li><strong>Storniert</strong> — Nur stornierte Patienten</li>
                <li><strong>Inaktiv / ✝</strong> — Inaktive und verstorbene Patienten (normalerweise ausgeblendet)</li>
              </ul>
            </li>
            <li>
              <strong>Aufgebot-Dropdown</strong> — Filtert nach Aufgebotsart: Brief, Reminder, Tel., Praxis oder «Kein RC»
            </li>
          </ul>
          <Tip>Alle Filter können kombiniert werden — z.B. «Überfällig» + «Brief» zeigt nur überfällige Briefaufgebote. «Filter zurücksetzen» löscht alle aktiven Filter auf einmal.</Tip>
        </Sub>

        <Sub id="recall-patient" title="Patient erfassen & bearbeiten">
          <p className="font-semibold">Neuen Patienten erfassen</p>
          <Step n={1}>Klicken Sie auf den blauen Button <strong>«+ Neu»</strong> in der Toolbar.</Step>
          <Step n={2}>Füllen Sie mindestens <strong>PID</strong>, <strong>Vorname</strong> und <strong>Geburtsdatum</strong> aus.</Step>
          <Step n={3}>Optionale Felder: Letzte / Nächste Konsultation, RC erstellen ab, Aufgebotsart, Patientenstatus.</Step>
          <Step n={4}>Klicken Sie auf <strong>«Speichern»</strong>. Der Patient erscheint sofort im aktiven Tab.</Step>
          <Tip>Wenn eine PID eingegeben wird, die bereits existiert, wird der Eintrag als «bestehender Patient» markiert (kein Neu-Badge).</Tip>

          <p className="font-semibold mt-3">Patienten bearbeiten</p>
          <Step n={1}>Klicken Sie auf eine Zeile in der Tabelle, um den Bearbeitungsdialog zu öffnen.</Step>
          <Step n={2}>Ändern Sie die gewünschten Felder und klicken Sie auf <strong>«Speichern»</strong>.</Step>
          <Step n={3}>Unter dem Formular kann der Patient einem anderen Arzt <strong>zugewiesen</strong> werden (Dropdown «Zuweisen an…» → «Zuweisen»).</Step>
          <Step n={4}>Mit dem <strong>Papierkorb-Symbol</strong> kann ein Patient unwiderruflich gelöscht werden (Bestätigungsdialog erscheint).</Step>

          <p className="font-semibold mt-3">Aufgebotsart direkt setzen</p>
          <p>In der Spalte <strong>«Aufgebotsart»</strong> sehen Sie beim Hover über eine Zeile kleine Icon-Buttons (Brief, Reminder, Tel., Praxis).
          Klicken Sie direkt auf ein Symbol, um die Aufgebotsart zu setzen oder zu deaktivieren — ohne den Bearbeitungsdialog zu öffnen.</p>

          <p className="font-semibold mt-3">Patient stornieren</p>
          <Step n={1}>Öffnen Sie den Bearbeitungsdialog durch Klick auf die Zeile.</Step>
          <Step n={2}>Setzen Sie das Feld <strong>«Storniert»</strong> auf «Ja» und wählen Sie einen <strong>Stornierungsgrund</strong> (z.B. kein Bedarf, Wegzug, Selbstmeldung, Verstorben, Arztwechsel, Brief ungeöffnet retourniert, Krankheit).</Step>
          <Step n={3}>Sobald ein Stornierungsgrund gewählt ist, erscheint automatisch der Abschnitt <strong>«Weiteres Vorgehen»</strong> — siehe nächster Abschnitt.</Step>
          <Step n={4}>Speichern. Die Zeile erscheint rot hinterlegt in der Tabelle. Beim Hover über «ja» sehen Sie den Grund.</Step>
        </Sub>

        <Sub id="recall-storno" title="Stornierung & Weiteres Vorgehen">
          <p>Sobald ein <strong>Stornierungsgrund</strong> gesetzt ist, erscheint im Bearbeitungsdialog ein amber-farbener Bereich <strong>«Weiteres Vorgehen»</strong>. Hier wird das Nachfassen beim Patienten dokumentiert — per Telefon, E-Mail oder Reminder.</p>

          <p className="font-semibold mt-3">Telefonanruf erfassen</p>
          <Step n={1}>Klicken Sie auf den Button <strong>«☎ Telefon»</strong>, um das Telefon-Panel zu öffnen. Das heutige Datum wird automatisch vorausgefüllt.</Step>
          <Step n={2}>Optional: Tragen Sie eine <strong>Bemerkung</strong> im Freitext-Feld ein (erscheint kursiv im Verlauf).</Step>
          <Step n={3}>
            <strong>Mit Datum</strong> (Anruf bereits durchgeführt): Tragen Sie das Anrufdatum ein und klicken Sie auf das Ergebnis:
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              <li><strong>Erreicht</strong> — Gespräch erfolgreich geführt</li>
              <li><strong>Nicht erreicht</strong> — Patient nicht erreichbar</li>
              <li><strong>Nr. nicht mehr gültig</strong> — Rufnummer ungültig</li>
            </ul>
          </Step>
          <Step n={4}>
            <strong>Ohne Datum</strong> (für später): Löschen Sie das Datum und klicken Sie <strong>«Als ‹noch zu erledigen› eintragen»</strong>. Der <Badge label="⏳ Patient anrufen" color="bg-amber-100 text-amber-700 border border-amber-300" />-Badge erscheint in der Tabelle.
          </Step>

          <p className="font-semibold mt-3">E-Mail erfassen</p>
          <p>Funktioniert identisch wie der Telefon-Ablauf — mit Datum-Vorausfüllung und den Ergebnissen <strong>«Geantwortet»</strong>, <strong>«Keine Antwort»</strong> und <strong>«E-Mail ungültig»</strong>.</p>

          <p className="font-semibold mt-3">Reminder planen</p>
          <Step n={1}>Klicken Sie auf den Button <strong>«🔔 Reminder»</strong>.</Step>
          <Step n={2}>Wählen Sie einen Zeitraum-Schnellwähler (<strong>1 Woche / 2 Wochen / 1 Monat / 3 Monate</strong>) oder geben Sie ein Datum manuell ein.</Step>
          <Step n={3}>Optional: Fügen Sie eine Bemerkung hinzu.</Step>
          <Step n={4}>Klicken Sie auf <strong>«Reminder eintragen»</strong>. Im Verlauf erscheint «Geplant: TT.MM.JJJJ».</Step>
          <p className="mt-2">Beim Eintragen des Reminders passiert automatisch:</p>
          <ul className="list-disc pl-5 space-y-0.5 mt-1">
            <li><strong>«RC erstellen ab»</strong> wird auf das Reminder-Datum gesetzt</li>
            <li><strong>«Briefaufgebot erstellt am»</strong>, <strong>«Storniert»</strong> und <strong>«Grund»</strong> werden geleert</li>
          </ul>
          <p className="mt-2">Wenn das geplante Datum erreicht ist, erscheint der Patient automatisch im Filter <Badge label="🔔 Reminder fällig" color="bg-purple-100 text-purple-700 border border-purple-200" /> — sowohl in der Filterleiste als auch im Dashboard.</p>
          <p className="mt-2"><strong>2. Reminder:</strong> Falls 6 Monate nach dem Reminder-Datum keine Rückmeldung erfolgt ist und kein neues Aufgebot erstellt wurde, setzt die App automatisch ein neues RC-Datum (Reminder + 6 Monate) und trägt einen System-Verlaufseintrag «2. Reminder» ein. In der Tabelle erscheint der <Badge label="🔔 2. Reminder" color="bg-orange-100 text-orange-700 border border-orange-300" />-Badge.</p>

          <p className="font-semibold mt-3">Patient inaktivieren</p>
          <p>Nach einem negativen Kontaktergebnis erscheint der Button <strong>«Patient inaktivieren»</strong>. Mit einem Klick wird der Status auf <Badge label="inaktiv" color="bg-gray-100 text-gray-600" /> gesetzt.</p>

          <p className="font-semibold mt-3">⏳ Noch zu erledigen — Badge in der Tabelle</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><Badge label="⏳ Patient anrufen" color="bg-amber-100 text-amber-700 border border-amber-300" /> — nur Telefon offen</li>
            <li><Badge label="⏳ E-Mail senden" color="bg-amber-100 text-amber-700 border border-amber-300" /> — nur E-Mail offen</li>
            <li><Badge label="⏳ Patient anrufen & E-Mail senden" color="bg-amber-100 text-amber-700 border border-amber-300" /> — beide offen</li>
          </ul>
          <Tip>Der Badge verschwindet automatisch, sobald alle offenen Einträge mit einem Ergebnis abgeschlossen wurden.</Tip>
        </Sub>

        <Sub id="recall-verlauf" title="Verlauf / Kontaktprotokoll">
          <p>Im selben amber-Bereich wie «Weiteres Vorgehen» befindet sich das <strong>Verlauf-Protokoll</strong>. Es zeigt alle Kontakte und Aufgebotsaktionen chronologisch — neueste zuerst.</p>

          <p className="font-semibold mt-3">Automatische Einträge</p>
          <p>Beim Speichern eines Aufgebots (Brief, Reminder, Tel., Praxis) wird automatisch ein Verlauf-Eintrag erstellt mit:</p>
          <ul className="list-disc pl-5 space-y-0.5 mt-1">
            <li><strong>Datum</strong> — Heutiges Datum</li>
            <li><strong>Aktion</strong> — z.B. «Briefaufgebot», «Reminder», «Telefonaufgebot»</li>
            <li><strong>Ergebnis</strong> — z.B. «Via Post», «Erstellt», «Anruf»</li>
            <li><strong>Von</strong> — Der angemeldete Benutzer</li>
          </ul>

          <p className="font-semibold mt-3">Manuelle Einträge via «Weiteres Vorgehen»</p>
          <p>Alle Tel- und E-Mail-Aktionen aus dem «Weiteres Vorgehen»-Bereich werden ebenfalls als Verlauf-Einträge gespeichert. Die Einträge können nicht manuell bearbeitet oder gelöscht werden — sie entstehen ausschliesslich durch Klick auf die vorgegebenen Buttons.</p>

          <p className="font-semibold mt-3">Darstellung im Verlauf</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>Einträge mit Ergebnis <strong>«noch zu erledigen»</strong> erscheinen in Amber-Farbe</li>
            <li>Abgeschlossene Einträge zeigen Datum, Aktion, Ergebnis und Benutzer-Kürzel</li>
            <li>Wenn eine <strong>Bemerkung (Grund)</strong> erfasst wurde, erscheint sie kursiv unter dem Eintrag</li>
            <li>Reminder-Einträge erscheinen in Lila mit dem geplanten Datum</li>
          </ul>
          <Tip>Der Verlauf dient als Nachweis aller unternommenen Kontaktversuche und wird bei jedem Öffnen des Bearbeitungsdialogs angezeigt.</Tip>
        </Sub>

        <Sub id="recall-excel" title="Excel-Abgleich (Graufärbung)">
          <p>Die Original-Excel-Datei <strong>«Suhr Patienten Alle Ärzte.xlsm»</strong> wird automatisch gefärbt, um auf einen Blick zu sehen, welche Patienten in der App bereits bearbeitet wurden:</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li><strong>Grau</strong> — Patient wurde in der App gespeichert (bearbeitet)</li>
            <li><strong>Weiss</strong> — Patient wurde noch nicht in der App bearbeitet</li>
          </ul>

          <p className="font-semibold mt-3">Wie funktioniert es?</p>
          <p>Ein VBA-Makro (<em>RecallSync</em>) ist direkt in die Excel-Datei eingebaut. Es wird <strong>automatisch beim Öffnen</strong> der Datei ausgeführt und holt die aktuellen Daten direkt aus Firebase.</p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>Kein separater Sync-Dienst oder Hintergrundprozess nötig</li>
            <li>Manuell ausführbar über: <strong>Entwicklertools → Makros → AktualisiereFaerbung</strong></li>
          </ul>

          <p className="font-semibold mt-3">Wann wird ein Patient als «bearbeitet» markiert?</p>
          <p>Jedes Mal wenn ein bestehender Patient in der App <strong>gespeichert</strong> wird (über den Bearbeitungsdialog), wird er automatisch als Excel-abgeglichen markiert. In der Tabelle erscheint dann ein grünes Tabellen-Symbol 🗃 in der Schnellaktionen-Spalte.</p>
          <Tip>Schnellaktionen (Tel. erreicht, nicht erreicht, Reminder, No Show) setzen den Abgleich nicht — nur das explizite Speichern via «Speichern»-Button.</Tip>
        </Sub>

        <Sub id="recall-zubearbeiten" title="Zu bearbeiten & Patientenliste Upload">
          <p>Der Tab <span className="text-amber-700 font-semibold">«Zu bearbeiten»</span> enthält Patienten aus der importierten Patientenliste (KIM), die noch keinem Arzt zugeordnet sind.</p>

          <p className="font-semibold mt-3">Patientenliste hochladen (Excel-Import)</p>
          <Step n={1}>Wechseln Sie zum Tab <strong>«Zu bearbeiten»</strong>.</Step>
          <Step n={2}>Klicken Sie auf den gelben Button <strong>«Patientenliste Upload»</strong>.</Step>
          <Step n={3}>Wählen Sie die Excel-Datei (.xlsx) aus — sie wird sofort verarbeitet.</Step>
          <Step n={4}>Patienten, die bereits einem Arzt zugeordnet sind, werden automatisch übersprungen.</Step>
          <Step n={5}>Die neu importierten Patienten erscheinen im Tab «Zu bearbeiten».</Step>
          <Tip>Der Import verhindert Duplikate automatisch — dieselbe Datei kann mehrfach hochgeladen werden, ohne dass Einträge doppelt erscheinen.</Tip>

          <p className="font-semibold mt-3">Patienten einem Arzt zuweisen</p>
          <Step n={1}>Klicken Sie auf einen Patienten im Tab «Zu bearbeiten».</Step>
          <Step n={2}>Im Bearbeitungsdialog sehen Sie unten das Dropdown <strong>«Zuweisen an…»</strong>.</Step>
          <Step n={3}>Wählen Sie den Arzt und klicken Sie auf <strong>«Zuweisen»</strong>.</Step>
          <Step n={4}>Der Patient wechselt sofort in den Tab des gewählten Arztes.</Step>
        </Sub>
      </Section>

      {/* ─── 15. AKV ──────────────────────────────────────────────────────── */}
      <Section id="akv" icon={ClipboardList} title="15. AKV (Aufgaben-Kompetenzen-Verantwortungen)">
        <p>
          Das <strong>AKV-Modul</strong> enthält die Verantwortungsmatrix der Praxis. Es zeigt auf einen Blick, wer für welche Aufgabe hauptverantwortlich, stellvertretend oder speziell zuständig ist.
          Admins können die Matrix bearbeiten, freigeben und drucken.
        </p>

        <Sub id="akv-tabelle" title="Verantwortungsmatrix lesen">
          <p>Die AKV-Tabelle ist in <strong>Kategorien</strong> (z. B. «Personalmanagement», «IT-Infrastruktur») gegliedert. Jede Zeile ist eine Aufgabe, jede Spalte eine Person.</p>
          <div className="space-y-1 mt-2">
            <CodeBadge code="H"  label="Hauptverantwortung — diese Person trägt die Gesamtverantwortung für die Aufgabe"  color="bg-blue-100 text-blue-800" />
            <CodeBadge code="S"  label="Stellvertretung — diese Person übernimmt bei Abwesenheit der hauptverantwortlichen Person" color="bg-green-100 text-green-800" />
            <CodeBadge code="SP" label="Spezialaufgabe — diese Person ist für einen speziellen Teilaspekt zuständig" color="bg-purple-100 text-purple-800" />
          </div>
          <Tip>Ist eine Aufgabe mit einer SOP verknüpft, erscheint rechts neben dem Aufgabentitel ein blauer «SOP»-Badge. Ein Klick darauf öffnet die entsprechende SOP-Seite direkt.</Tip>
        </Sub>

        <Sub id="akv-bearbeiten" title="Aufgaben verwalten (Admin)">
          <p>Admins und Geschäftsleitung können Aufgaben hinzufügen, bearbeiten und löschen sowie neue Kategorien erstellen.</p>

          <p className="font-semibold mt-3">Aufgabe hinzufügen</p>
          <Step n={1}>Klicken Sie am Ende einer Kategorie auf <strong>«+ Aufgabe hinzufügen»</strong>.</Step>
          <Step n={2}>Geben Sie den Aufgabentitel ein.</Step>
          <Step n={3}>Optional: Verknüpfen Sie die Aufgabe mit einer SOP-Seite über das Dropdown <strong>«SOP verknüpfen»</strong> — der Titel wird automatisch übernommen.</Step>
          <Step n={4}>Klicken Sie auf <strong>«Hinzufügen»</strong>.</Step>

          <p className="font-semibold mt-3">Aufgabe bearbeiten oder löschen</p>
          <Step n={1}>Fahren Sie mit der Maus über den Aufgabentitel — ein <strong>Stift-Symbol</strong> erscheint.</Step>
          <Step n={2}>Klicken Sie auf das Symbol, um den Bearbeitungsdialog zu öffnen.</Step>
          <Step n={3}>Ändern Sie Titel, SOP-Verknüpfung oder Zuweisungen.</Step>
          <Step n={4}>Klicken Sie auf <strong>«Speichern»</strong> oder auf den roten <strong>«Löschen»</strong>-Button, um die Aufgabe zu entfernen.</Step>

          <p className="font-semibold mt-3">Neue Kategorie erstellen</p>
          <Step n={1}>Scrollen Sie ans Ende der Tabelle und klicken Sie auf <strong>«+ Neue Kategorie»</strong>.</Step>
          <Step n={2}>Geben Sie den Kategorienamen und eine erste Aufgabe ein.</Step>
          <Step n={3}>Klicken Sie auf <strong>«Erstellen»</strong>.</Step>
        </Sub>

        <Sub id="akv-personen" title="Personen verwalten (Admin)">
          <p>Über den Button <strong>«Personen verwalten»</strong> oben rechts in der AKV können Admins die Personenspalten anpassen.</p>
          <ul className="list-disc pl-5 space-y-1.5 mt-2">
            <li><strong>Name & Funktion:</strong> Jede Person hat einen Namen und eine Funktion (z. B. MPA, Arzt/Ärztin, GL).</li>
            <li><strong>Benutzerkonto verknüpfen:</strong> Über das Dropdown kann eine Person mit einem bestehenden Benutzerkonto verknüpft werden. Die Funktion wird dabei automatisch aus der Rolle des Benutzerkontos übernommen.</li>
            <li><strong>Neue Person:</strong> Klicken Sie auf <strong>«+ Person hinzufügen»</strong>, um eine neue Spalte anzulegen.</li>
            <li><strong>Person entfernen:</strong> Klicken Sie auf das rote Mülleimer-Symbol. Alle bisherigen Zuweisungen dieser Person werden ebenfalls gelöscht.</li>
          </ul>
          <Tip>Beim Umbenennen einer Person werden alle bestehenden Zuweisungen automatisch auf den neuen Namen übertragen — keine Daten gehen verloren.</Tip>
        </Sub>

        <Sub id="akv-schulung" title="Relevant für & Schulungsnachweis">
          <p>Admins können im AKV festlegen, welche Personen das Dokument lesen und bestätigen müssen.</p>

          <p className="font-semibold mt-3">Relevant für festlegen (Admin)</p>
          <Step n={1}>Klicken Sie oben rechts auf <strong>«Relevant für»</strong>.</Step>
          <Step n={2}>Setzen Sie die Häkchen bei allen Personen, die das AKV-Dokument bestätigen müssen.</Step>
          <Step n={3}>Die Änderung wird sofort gespeichert.</Step>

          <p className="font-semibold mt-3">Schulungsnachweis bestätigen (alle Benutzer)</p>
          <p>Wenn Sie in der «Relevant für»-Liste stehen, erscheint oben ein <strong>«Gelesen und verstanden»</strong>-Button.</p>
          <Step n={1}>Lesen Sie das AKV-Dokument durch.</Step>
          <Step n={2}>Klicken Sie auf <strong>«Gelesen und verstanden — Bestätigen»</strong>.</Step>
          <Step n={3}>Ihre Bestätigung wird mit Datum und Uhrzeit gespeichert.</Step>
          <p className="mt-2">Die Fortschrittsanzeige oben (<em>Schulungsnachweis: X / Y</em>) zeigt, wie viele Personen bereits bestätigt haben.</p>
          <Tip>Der Schulungsnachweis wird automatisch zurückgesetzt, wenn das Dokument auf «Entwurf» zurückgesetzt wird — alle Bestätigungen müssen dann erneut durchgeführt werden.</Tip>
        </Sub>

        <Sub id="akv-freigabe" title="Freigabe & Drucken">
          <p className="font-semibold">Dokument freigeben</p>
          <p>Admins und Geschäftsleitung können das AKV-Dokument über den Button <strong>«Freigeben»</strong> offiziell in Kraft setzen.</p>
          <Step n={1}>Klicken Sie auf <strong>«Freigeben»</strong> (oben rechts im Dokumentkopf).</Step>
          <Step n={2}>Tragen Sie das <strong>Gültig-ab-Datum</strong> und die <strong>Versionsnummer</strong> ein.</Step>
          <Step n={3}>Klicken Sie auf <strong>«Freigeben»</strong> — der Status wechselt von «Entwurf» auf <Badge label="Final" color="bg-green-100 text-green-800" />.</Step>

          <p className="font-semibold mt-3">Zurück zu Entwurf</p>
          <p>Ein freigegebenes Dokument kann über <strong>«Zurück zu Entwurf»</strong> wieder in den Bearbeitungsmodus versetzt werden. Dabei werden alle Schulungsnachweis-Bestätigungen zurückgesetzt.</p>

          <p className="font-semibold mt-3">Drucken (A4 Querformat)</p>
          <Step n={1}>Klicken Sie auf das <strong>Drucker-Symbol</strong> oben rechts.</Step>
          <Step n={2}>Der Browser-Druckdialog öffnet sich — das Dokument ist automatisch für <strong>A4 Querformat</strong> formatiert.</Step>
          <Step n={3}>Wählen Sie Ihren Drucker oder <strong>«Als PDF speichern»</strong> und klicken Sie auf «Drucken».</Step>
          <Tip>Für eine optimale Darstellung empfiehlt sich «Hintergrundgrafiken drucken» zu deaktivieren und die Seitenränder auf «Minimal» zu setzen.</Tip>
        </Sub>
      </Section>

      {/* ─── 16. HILFE-MODUS ──────────────────────────────────────────────── */}
      <Section id="hilfe-modus" icon={BookOpen} title="16. Hilfe-Modus">
        <p>
          Der <strong>Hilfe-Modus</strong> ermöglicht es, in der App selbst Erklärungen zu einzelnen Elementen abzurufen — ohne das Handbuch zu öffnen.
        </p>

        <Sub title="Hilfe-Modus aktivieren">
          <Step n={1}>Klicken Sie oben rechts in der Navigationsleiste auf das <strong>Fragezeichen-Symbol (?)</strong>.</Step>
          <Step n={2}>Ein blauer Banner erscheint: <em>«Hilfe-Modus aktiv»</em>. Der Mauszeiger ändert sich.</Step>
          <Step n={3}>Klicken Sie auf ein beliebiges Element in der App — egal ob Button, Text oder Bereich.</Step>
          <Step n={4}>Es erscheint ein kleines Popup mit einer Erklärung des angeklickten Elements.</Step>
          <Step n={5}>Falls vorhanden, gibt es im Popup einen Link <strong>«Benutzerhandbuch →»</strong>, der direkt zum passenden Abschnitt hier führt.</Step>
        </Sub>

        <Sub title="Hilfe-Modus beenden">
          <p>Klicken Sie erneut auf das <strong>Fragezeichen-Symbol (?)</strong> oben rechts, oder drücken Sie die <strong>ESC-Taste</strong>.</p>
        </Sub>

        <Sub title="Dieses Handbuch">
          <p>Das vollständige Handbuch ist jederzeit über das <strong>Buch-Symbol (📖)</strong> neben dem Fragezeichen erreichbar. Das Handbuch erklärt alle Funktionen in der Übersicht und kann als Nachschlagewerk verwendet werden.</p>
        </Sub>
      </Section>

      {/* Scroll-to-top button */}
      <button
        onClick={()=>{
          const scroller=(containerRef.current?.closest('.overflow-auto')||containerRef.current?.closest('.overflow-y-auto')) as HTMLElement|null
          if(scroller) scroller.scrollTo({top:0,behavior:'smooth'})
          else window.scrollTo({top:0,behavior:'smooth'})
        }}
        className="fixed bottom-6 right-6 z-50 p-3 bg-primary-600 text-white rounded-full shadow-lg hover:bg-primary-700 transition-colors"
        title="Nach oben">
        <ArrowUp className="w-5 h-5"/>
      </button>
    </div>
  )
}
