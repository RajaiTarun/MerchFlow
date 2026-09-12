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
    <nav>
      {token ? (
        <>
          <Link to="/catalog">Catalog</Link>
          <Link to="/dashboard">Dashboard</Link>
          {(user.role === 'CLUB_ADMIN' || user.role === 'SUPER_ADMIN') && (
            <Link to="/admin">Admin</Link>
          )}
          <button onClick={handleLogout}>Logout</button>
        </>
      ) : (
        <>
          <Link to="/login">Login</Link>
          <Link to="/register">Register</Link>
        </>
      )}
    </nav>
  )
}

export default Navbar
