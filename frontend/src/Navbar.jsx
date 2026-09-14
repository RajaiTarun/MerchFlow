import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'

function Navbar() {
  const { token, user, logout } = useAuth()
  const navigate = useNavigate()

  const isClubAdmin = token && (user.role === 'CLUB_ADMIN' || user.role === 'SUPER_ADMIN')
  const isSuperAdmin = token && user.role === 'SUPER_ADMIN'

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <nav className="border-b border-gray-200 px-4 py-3 flex items-center gap-4 flex-wrap">
      <span className="font-semibold">CCMMS</span>
      {token ? (
        <>
          <Link to="/catalog" className="text-blue-600 hover:underline">
            Catalog
          </Link>
          <Link to="/profile" className="text-blue-600 hover:underline">
            Profile
          </Link>
          <Link to="/orders" className="text-blue-600 hover:underline">
            Orders
          </Link>
          <Link to="/notifications" className="text-blue-600 hover:underline">
            Notifications
          </Link>
          {isClubAdmin && (
            <>
              <Link to="/admin/create-item" className="text-blue-600 hover:underline">
                Create Item
              </Link>
              <Link to="/admin/delivery-slots" className="text-blue-600 hover:underline">
                Delivery Slots
              </Link>
              <Link to="/admin/orders" className="text-blue-600 hover:underline">
                Club Orders
              </Link>
            </>
          )}
          {isSuperAdmin && (
            <>
              <Link to="/admin/promote" className="text-blue-600 hover:underline">
                Promote User
              </Link>
              <Link to="/admin/create-club" className="text-blue-600 hover:underline">
                Create Club
              </Link>
            </>
          )}
          <button
            onClick={handleLogout}
            className="ml-auto text-sm border border-gray-300 rounded px-3 py-1 hover:bg-gray-100"
          >
            Logout
          </button>
        </>
      ) : (
        <>
          <Link to="/login" className="text-blue-600 hover:underline ml-auto">
            Login
          </Link>
          <Link to="/register" className="text-blue-600 hover:underline">
            Register
          </Link>
        </>
      )}
    </nav>
  )
}

export default Navbar
