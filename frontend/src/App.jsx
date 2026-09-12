import { Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './Navbar.jsx'
import ProtectedRoute from './ProtectedRoute.jsx'
import LoginPage from './pages/LoginPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import CatalogPage from './pages/CatalogPage.jsx'
import ItemDetailPage from './pages/ItemDetailPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import AdminPage from './pages/AdminPage.jsx'

function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<Navigate to="/catalog" />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/catalog"
          element={
            <ProtectedRoute>
              <CatalogPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/catalog/:id"
          element={
            <ProtectedRoute>
              <ItemDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={['CLUB_ADMIN', 'SUPER_ADMIN']}>
              <AdminPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </>
  )
}

export default App
