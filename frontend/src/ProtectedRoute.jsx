import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'

function ProtectedRoute({ children, roles }) {
  const { token, user, loading } = useAuth()

  // AuthContext is still checking localStorage for an existing token - don't
  // redirect yet, or a page refresh would always bounce to /login first.
  if (loading) {
    return null
  }

  if (!token) {
    return <Navigate to="/login" />
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/catalog" />
  }

  return children
}

export default ProtectedRoute
