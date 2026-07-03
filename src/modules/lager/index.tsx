import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { Package, Truck, ClipboardList } from 'lucide-react'
import StockOverview from './pages/StockOverview'
import ArticleDetail from './pages/ArticleDetail'
import SupplierList from './pages/SupplierList'
import InventurPage from './pages/InventurPage'

function LagerNav() {
  const loc = useLocation()
  const isDetail = /\/lager\/[^/]+$/.test(loc.pathname.replace(/\/$/, ''))
  if (isDetail) return null

  return (
    <div className="border-b border-gray-200 bg-white px-2 sm:px-6 flex items-center gap-2 sm:gap-3 overflow-x-auto">
      <div className="w-px h-6 bg-gray-200 shrink-0" />
      <NavLink to="" end
        className={({ isActive }) =>
          `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            isActive && !loc.pathname.includes('lieferanten') && !loc.pathname.includes('inventur')
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`
        }>
        <Package className="w-4 h-4" /> Artikel
      </NavLink>
      <NavLink to="lieferanten"
        className={({ isActive }) =>
          `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            isActive
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`
        }>
        <Truck className="w-4 h-4" /> Lieferanten
      </NavLink>
      <NavLink to="inventur"
        className={({ isActive }) =>
          `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            isActive
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`
        }>
        <ClipboardList className="w-4 h-4" /> Inventur
      </NavLink>
    </div>
  )
}

export default function LagerModule() {
  return (
    <div>
      <LagerNav />
      <Routes>
        <Route index element={<StockOverview />} />
        <Route path="lieferanten" element={<SupplierList />} />
        <Route path="inventur" element={<InventurPage />} />
        <Route path=":id" element={<ArticleDetail />} />
      </Routes>
    </div>
  )
}
