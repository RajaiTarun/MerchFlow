import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'

function ProtectedRoute({ children, roles }) {
  const { token, user } = useAuth()

  if (!token) {
    return <Navigate to="/login" />
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/catalog" />
  }

  return children
}

export default ProtectedRoute
