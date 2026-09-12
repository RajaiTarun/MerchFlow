import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api.js'

const DOMAIN_REGEX = /^[a-zA-Z0-9._%+-]+@students\.iiit\.ac\.in$/

function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  // Purely a nicer UX touch - the backend's 403 is the real authority.
  const showDomainWarning = email.length > 0 && !DOMAIN_REGEX.test(email)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    try {
      await apiFetch('/users/register', {
        method: 'POST',
        body: { email, password, full_name: fullName },
      })
      setSuccess(true)
    } catch (err) {
      setError(err.body?.error || err.message)
    }
  }

  if (success) {
    return (
      <div>
        <p>Registered! Please log in.</p>
        <Link to="/login">Go to login</Link>
      </div>
    )
  }

  return (
    <div>
      <h2>Register</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email">Email</label>
          <br />
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {showDomainWarning && (
            <p className="error-text">Must be an @students.iiit.ac.in email</p>
          )}
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <br />
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="fullName">Full name</label>
          <br />
          <input
            id="fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn">
          Register
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  )
}

export default RegisterPage
