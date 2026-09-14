import { Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './Navbar.jsx'
import ProtectedRoute from './ProtectedRoute.jsx'
import LoginPage from './pages/LoginPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import CatalogPage from './pages/CatalogPage.jsx'
import ItemDetailPage from './pages/ItemDetailPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import OrdersPage from './pages/OrdersPage.jsx'
import NotificationsPage from './pages/NotificationsPage.jsx'
import CreateItemPage from './pages/CreateItemPage.jsx'
import DeliverySlotsPage from './pages/DeliverySlotsPage.jsx'
import ClubOrdersPage from './pages/ClubOrdersPage.jsx'
import PromoteUserPage from './pages/PromoteUserPage.jsx'
import CreateClubPage from './pages/CreateClubPage.jsx'

const CLUB_ADMIN_ROLES = ['CLUB_ADMIN', 'SUPER_ADMIN']

function App() {
  return (
    <>
      <Navbar />
      <main className="max-w-3xl mx-auto p-4">
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
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders"
            element={
              <ProtectedRoute>
                <OrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/notifications"
            element={
              <ProtectedRoute>
                <NotificationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/create-item"
            element={
              <ProtectedRoute roles={CLUB_ADMIN_ROLES}>
                <CreateItemPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/delivery-slots"
            element={
              <ProtectedRoute roles={CLUB_ADMIN_ROLES}>
                <DeliverySlotsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/orders"
            element={
              <ProtectedRoute roles={CLUB_ADMIN_ROLES}>
                <ClubOrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/promote"
            element={
              <ProtectedRoute roles={['SUPER_ADMIN']}>
                <PromoteUserPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/create-club"
            element={
              <ProtectedRoute roles={['SUPER_ADMIN']}>
                <CreateClubPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
    </>
  )
}

export default App
