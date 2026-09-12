import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

const TOKEN_KEY = 'ccmms_token'

// A JWT is just three base64url segments separated by dots. This reads the
// middle segment (the payload/claims) without verifying the signature - the
// backend already verified it; we're only reading it here to drive the UI.
function decodeJwt(token) {
  const payload = token.split('.')[1]
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null)
  const [user, setUser] = useState(null)

  // Runs once when the app first loads, so a page refresh doesn't log the user out.
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY)
    if (!stored) return

    try {
      const decoded = decodeJwt(stored)
      if (decoded.exp && decoded.exp * 1000 < Date.now()) {
        localStorage.removeItem(TOKEN_KEY)
        return
      }
      setToken(stored)
      setUser(decoded)
    } catch {
      localStorage.removeItem(TOKEN_KEY)
    }
  }, [])

  function login(newToken) {
    const decoded = decodeJwt(newToken)
    localStorage.setItem(TOKEN_KEY, newToken)
    setToken(newToken)
    setUser(decoded)
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
