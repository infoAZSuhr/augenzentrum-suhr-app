import { Routes, Route, Navigate } from 'react-router-dom'
import EinsatzplanungPage from './EinsatzplanungPage'

export default function PlanungModule() {
  return (
    <Routes>
      <Route index element={<EinsatzplanungPage />} />
      <Route path="*" element={<Navigate to="" replace />} />
    </Routes>
  )
}
