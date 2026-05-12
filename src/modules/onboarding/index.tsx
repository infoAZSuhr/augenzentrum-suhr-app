import { Routes, Route, Navigate } from 'react-router-dom'
import OnboardingOverview from './pages/OnboardingOverview'

export default function OnboardingModule() {
  return (
    <Routes>
      <Route index element={<OnboardingOverview />} />
      <Route path="page/:pageId" element={<OnboardingOverview />} />
      <Route path="*" element={<Navigate to="" replace />} />
    </Routes>
  )
}
