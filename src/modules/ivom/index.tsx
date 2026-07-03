import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import PatientList from './pages/PatientList'
import PatientDetail from './pages/PatientDetail'
import IVOMCalendar from './pages/IVOMCalendar'
import IVOMSettings from './pages/IVOMSettings'
import IVOMTagesplanung from './pages/IVOMTagesplanung'
import IVOMDokumente from './pages/IVOMDokumente'

const NAV_TABS = [
  { to: '/ivom', label: 'Tagesplanung', end: true },
  { to: '/ivom/patienten', label: 'Patienten', end: false },
  { to: '/ivom/kalender', label: 'Kalender', end: false },
  { to: '/ivom/dokumente', label: 'Dokumente', end: false },
  { to: '/ivom/einstellungen', label: 'Einstellungen', end: false },
]

export default function IVOMModule() {
  const location = useLocation()
  const isDetail = /^\/ivom\/[^/]+$/.test(location.pathname) &&
    !location.pathname.includes('kalender') &&
    !location.pathname.includes('einstellungen') &&
    !location.pathname.includes('patienten') &&
    !location.pathname.includes('dokumente')

  return (
    <div className="flex flex-col h-full">
      {!isDetail && (
        <div className="px-2 sm:px-6 pt-2 sm:pt-4 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-px h-6 bg-gray-200 shrink-0 mb-2 sm:mb-4" />
            <nav className="flex gap-1 flex-1 overflow-x-auto">
              {NAV_TABS.map(tab => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) =>
                    `px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                      isActive
                        ? 'border-primary-600 text-primary-700 bg-primary-50'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`
                  }
                >
                  {tab.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <Routes>
          <Route index element={<IVOMTagesplanung />} />
          <Route path="tagesplanung" element={<IVOMTagesplanung />} />
          <Route path="patienten" element={<PatientList />} />
          <Route path="dokumente" element={<IVOMDokumente />} />
          <Route path="kalender" element={<IVOMCalendar />} />
          <Route path="einstellungen" element={<IVOMSettings />} />
          <Route path=":id" element={<PatientDetail />} />
        </Routes>
      </div>
    </div>
  )
}
