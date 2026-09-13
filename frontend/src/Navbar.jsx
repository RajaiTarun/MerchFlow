import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'

function Navbar() {
  const { token, user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <nav className="border-b border-gray-200 px-4 py-3 flex items-center gap-4">
      <span className="font-semibold">CCMMS</span>
      {token ? (
        <>
          <Link to="/catalog" className="text-blue-600 hover:underline">
            Catalog
          </Link>
          <Link to="/dashboard" className="text-blue-600 hover:underline">
            Dashboard
          </Link>
          {(user.role === 'CLUB_ADMIN' || user.role === 'SUPER_ADMIN') && (
            <Link to="/admin" className="text-blue-600 hover:underline">
              Admin
            </Link>
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
