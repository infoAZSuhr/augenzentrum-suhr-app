import { lazy, Suspense, useState, useEffect, useRef, useCallback, ReactNode } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { NoticesProvider } from './lib/NoticesContext'
import { BrowserProvider } from './contexts/BrowserContext'
import AppShell from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import LoginPage from './pages/LoginPage'
import PendingApprovalPage from './pages/PendingApprovalPage'
import UserManagementPage from './pages/UserManagementPage'
import RequestLogPage from './pages/RequestLogPage'
import LidPage from './pages/LidPage'
import KatPage from './pages/KatPage'
import ForceChangePasswordPage from './pages/ForceChangePasswordPage'
import HelpPage from './pages/HelpPage'
import TasksPage from './pages/TasksPage'
import TaskBoardPage from './pages/TaskBoardPage'
import RecallPage from './pages/RecallPage'
import ZuweisungPage from './pages/ZuweisungPage'
import AkvPage from './pages/AkvPage'
import AdminSystemPage from './pages/AdminSystemPage'
import SekretariatChatPage from './pages/SekretariatChatPage'

const IVOMModule        = lazy(() => import('./modules/ivom'))
const LagerModule       = lazy(() => import('./modules/lager'))
const PlanungModule     = lazy(() => import('./modules/planung'))
const OnboardingModule  = lazy(() => import('./modules/onboarding'))

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 30, retry: 1 } },
})

function Loading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
    </div>
  )
}

function BlockedPage({ reason }: { reason: 'rejected' | 'locked' | 'tooManyAttempts' }) {
  const { logout } = useAuth()
  const title = reason === 'tooManyAttempts'
    ? 'Konto vorübergehend gesperrt'
    : reason === 'locked' ? 'Konto gesperrt' : 'Zugriff verweigert'
  const msg = reason === 'tooManyAttempts'
    ? 'Zu viele fehlgeschlagene Anmeldeversuche. Ihr Konto wurde gesperrt. Bitte wenden Sie sich an den Administrator.'
    : reason === 'locked'
    ? 'Ihr Konto wurde vom Administrator gesperrt. Bitte nehmen Sie Kontakt auf.'
    : 'Ihr Konto wurde abgelehnt. Bitte wenden Sie sich an den Administrator.'
  const icon = reason === 'tooManyAttempts' ? '🔒' : reason === 'locked' ? '⛔' : '❌'

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
        <div className="text-4xl mb-4">{icon}</div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">{title}</h2>
        <p className="text-sm text-gray-500 mb-6">{msg}</p>
        <button onClick={logout}
          className="text-sm text-gray-500 underline hover:text-gray-700 transition-colors">
          Abmelden
        </button>
      </div>
    </div>
  )
}

const INACTIVITY_MS   = 15 * 60 * 1000   // 15 min until logout
const WARN_BEFORE_MS  =  2 * 60 * 1000   // warn 2 min before (at 13 min)
const WARN_SECONDS    = 120               // countdown duration in seconds

function InactivityLogout() {
  const { logout } = useAuth()
  const [warning, setWarning]   = useState(false)
  const [countdown, setCountdown] = useState(WARN_SECONDS)
  const logoutTimer  = useRef<ReturnType<typeof setTimeout>  | null>(null)
  const warnTimer    = useRef<ReturnType<typeof setTimeout>  | null>(null)
  const countdownInt = useRef<ReturnType<typeof setInterval> | null>(null)

  const reset = useCallback(() => {
    setWarning(false)
    setCountdown(WARN_SECONDS)
    if (logoutTimer.current)  clearTimeout(logoutTimer.current)
    if (warnTimer.current)    clearTimeout(warnTimer.current)
    if (countdownInt.current) clearInterval(countdownInt.current)

    warnTimer.current = setTimeout(() => {
      setWarning(true)
      let sec = WARN_SECONDS
      countdownInt.current = setInterval(() => {
        sec -= 1
        setCountdown(sec)
        if (sec <= 0 && countdownInt.current) clearInterval(countdownInt.current)
      }, 1000)
    }, INACTIVITY_MS - WARN_BEFORE_MS)

    logoutTimer.current = setTimeout(() => logout(), INACTIVITY_MS)
  }, [logout])

  useEffect(() => {
    reset()
    const events = ['mousemove','mousedown','keydown','scroll','touchstart','click'] as const
    events.forEach(e => window.addEventListener(e, reset, { passive: true }))
    return () => {
      events.forEach(e => window.removeEventListener(e, reset))
      if (logoutTimer.current)  clearTimeout(logoutTimer.current)
      if (warnTimer.current)    clearTimeout(warnTimer.current)
      if (countdownInt.current) clearInterval(countdownInt.current)
    }
  }, [reset])

  if (!warning) return null

  const mins = Math.floor(countdown / 60)
  const secs = String(countdown % 60).padStart(2, '0')

  return (
    <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center space-y-3">
        <div className="text-4xl">⏱️</div>
        <h2 className="text-lg font-bold text-gray-900">Sitzung läuft ab</h2>
        <p className="text-sm text-gray-500">Aufgrund von Inaktivität werden Sie in</p>
        <p className="text-4xl font-bold text-red-600">{mins}:{secs}</p>
        <p className="text-sm text-gray-500">automatisch abgemeldet.</p>
        <button onClick={reset}
          className="w-full mt-2 px-4 py-3 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 transition-colors">
          Aktiv bleiben
        </button>
      </div>
    </div>
  )
}

function PermissionGate({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  if (!allowed) return <Navigate to="/" replace />
  return <>{children}</>
}

function RoutesWithPermissions() {
  const { isAdmin, isGeschaeftsleitung, canAccessIvom, canAccessLager, canAccessPlanung, canAccessSOP, canAccessRecall, canAccessAkv, canAccessSekretariatChat, canAccessBenutzerverwaltung } = useAuth()
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="ivom/*"       element={<PermissionGate allowed={canAccessIvom}><Suspense fallback={<Loading />}><IVOMModule /></Suspense></PermissionGate>} />
        <Route path="lid"          element={<PermissionGate allowed={canAccessIvom}><LidPage /></PermissionGate>} />
        <Route path="kat"          element={<PermissionGate allowed={canAccessIvom}><KatPage /></PermissionGate>} />
        <Route path="lager/*"      element={<PermissionGate allowed={canAccessLager}><Suspense fallback={<Loading />}><LagerModule /></Suspense></PermissionGate>} />
        <Route path="planung/*"    element={<PermissionGate allowed={canAccessPlanung}><Suspense fallback={<Loading />}><PlanungModule /></Suspense></PermissionGate>} />
        <Route path="sop/*"        element={<PermissionGate allowed={canAccessSOP}><Suspense fallback={<Loading />}><OnboardingModule /></Suspense></PermissionGate>} />
        <Route path="admin/users"  element={<PermissionGate allowed={canAccessBenutzerverwaltung}><UserManagementPage /></PermissionGate>} />
        <Route path="admin/log"    element={<PermissionGate allowed={isAdmin || isGeschaeftsleitung}><RequestLogPage /></PermissionGate>} />
        <Route path="admin/system" element={<PermissionGate allowed={isAdmin || isGeschaeftsleitung}><AdminSystemPage /></PermissionGate>} />
        <Route path="aufgaben"           element={<TasksPage />} />
        <Route path="aufgaben/:boardId"  element={<TaskBoardPage />} />
        <Route path="recall"        element={<PermissionGate allowed={canAccessRecall}><RecallPage /></PermissionGate>} />
        <Route path="zuweisungen"  element={<PermissionGate allowed={canAccessRecall}><ZuweisungPage /></PermissionGate>} />
        <Route path="akv"          element={<PermissionGate allowed={canAccessAkv}><AkvPage /></PermissionGate>} />
        <Route path="sekretariat-chat" element={<PermissionGate allowed={canAccessSekretariatChat}><SekretariatChatPage /></PermissionGate>} />
        <Route path="hilfe"        element={<HelpPage />} />
      </Route>
    </Routes>
  )
}

function AppRoutes() {
  const { user, profile, loading } = useAuth()

  if (loading) return <Loading />

  // Not logged in
  if (!user) return <LoginPage />

  // Pending approval
  if (profile?.status === 'pending') return <PendingApprovalPage />

  // Rejected
  if (profile?.status === 'rejected') return <BlockedPage reason="rejected" />

  // Locked by admin
  if (profile?.locked && profile.lockedReason !== 'tooManyAttempts') return <BlockedPage reason="locked" />

  // Locked due to too many attempts
  if (profile?.locked && profile.lockedReason === 'tooManyAttempts') return <BlockedPage reason="tooManyAttempts" />

  // Force password change (provisional password set by admin)
  if (profile?.mustChangePassword) return <ForceChangePasswordPage />

  return (
    <HashRouter>
      <NoticesProvider>
        <InactivityLogout />
        <RoutesWithPermissions />
      </NoticesProvider>
    </HashRouter>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserProvider>
          <AppRoutes />
        </BrowserProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
