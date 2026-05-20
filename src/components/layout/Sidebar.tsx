import { NavLink } from 'react-router-dom'
import { Eye, Package, LayoutDashboard, CalendarDays, Users, LogOut, X, BookOpen, Phone, ClipboardList, ShieldCheck } from 'lucide-react'
import { cn } from '../../utils/cn'
import { version } from '../../../package.json'
import { useAuth } from '../../lib/AuthContext'

interface SidebarProps {
  onClose?: () => void
}

export default function Sidebar({ onClose }: SidebarProps) {
  const {
    profile, isAdmin, isGuest, isGeschaeftsleitung, logout,
    canAccessIvom, canAccessLager, canAccessPlanung, canAccessSOP,
    canAccessRecall, canAccessAkv,
  } = useAuth()

  const navItems = [
    { to: '/',        label: 'Dashboard',       icon: LayoutDashboard, end: true,  show: true },
    { to: '/ivom',    label: 'IVI-Manager',     icon: Eye,             end: false, show: canAccessIvom },
    { to: '/lager',   label: 'Lagermanagement', icon: Package,         end: false, show: canAccessLager },
    { to: '/planung', label: 'Einsatzplanung',  icon: CalendarDays,    end: false, show: canAccessPlanung },
    { to: '/sop',     label: 'SOP',             icon: BookOpen,        end: false, show: canAccessSOP },
    { to: '/recall',  label: 'Recall',          icon: Phone,           end: false, show: canAccessRecall },
    { to: '/akv',     label: 'AKV',             icon: ClipboardList,   end: false, show: canAccessAkv },
  ]

  return (
    <aside className="w-56 h-full bg-white border-r border-gray-200 flex flex-col">
      {/* Logo + close (mobile) */}
      <div className="px-4 py-5 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="w-6 h-6 text-primary-600" />
          <div>
            <p className="font-semibold text-sm text-gray-900 leading-none">Augenzentrum</p>
            <p className="text-xs text-gray-500">Suhr</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose}
            className="lg:hidden p-1 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navItems.filter(item => item.show).map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </NavLink>
        ))}

        {/* Benutzerverwaltung — nur Admin und GL */}
        {(isAdmin || isGeschaeftsleitung) && (
          <>
            <div className="pt-3 pb-1 px-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Administration</p>
            </div>
            <NavLink
              to="/admin/users"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )
              }
            >
              <Users className="w-4 h-4 shrink-0" />
              Benutzerverwaltung
            </NavLink>
            <NavLink
              to="/admin/system"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )
              }
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              System & Export
            </NavLink>
          </>
        )}
      </nav>

      {/* User + Footer */}
      <div className="px-3 py-3 border-t border-gray-200 space-y-2">
        {profile && (
          <div className="flex items-center gap-2 px-1">
            <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
              <span className="text-[11px] font-bold text-primary-700">
                {(profile.username || profile.displayName)?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-800 truncate leading-tight">{profile.username || profile.displayName}</p>
              <p className="text-[10px] text-gray-400 truncate leading-tight">
                {isGuest ? 'Gast (nur lesen)' : profile.role === 'mpa' ? 'MPA' : profile.role === 'arzt' ? 'Arzt/Ärztin' : 'Admin'}
              </p>
            </div>
            <button onClick={logout} title="Abmelden"
              className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 px-1">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            In Entwicklung
          </span>
        </div>
        <p className="text-xs text-gray-400 px-1">v{version}</p>
      </div>
    </aside>
  )
}
