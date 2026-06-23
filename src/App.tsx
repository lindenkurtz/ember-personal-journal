import { Routes, Route, Navigate } from 'react-router-dom'
import Morning from './pages/Morning'
import Dashboard from './pages/Dashboard'
import Evening from './pages/Evening'
import Patterns from './pages/Patterns'
import Finance from './pages/Finance'
import Settings from './pages/Settings'

export default function App() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/morning" element={<Morning />} />
        <Route path="/evening" element={<Evening />} />
        <Route path="/patterns" element={<Patterns />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/settings" element={<Settings />} />
        {/* Old /dashboard path kept as a redirect so any saved links still resolve. */}
        <Route path="/dashboard" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
