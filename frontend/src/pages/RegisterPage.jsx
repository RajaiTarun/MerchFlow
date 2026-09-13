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
      <div className="max-w-sm mx-auto">
        <p className="mb-3">Registered! Please log in.</p>
        <Link to="/login" className="text-blue-600 hover:underline">
          Go to login
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-sm mx-auto">
      <h2 className="text-xl font-semibold mb-4">Register</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full border border-gray-300 rounded px-3 py-2"
          />
          {showDomainWarning && (
            <p className="text-red-600 text-sm mt-1">
              Must be an @students.iiit.ac.in email
            </p>
          )}
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full border border-gray-300 rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="fullName" className="block text-sm font-medium mb-1">
            Full name
          </label>
          <input
            id="fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2"
          />
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          type="submit"
          className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700"
        >
          Register
        </button>
      </form>
      <p className="mt-4 text-sm">
        Already have an account?{' '}
        <Link to="/login" className="text-blue-600 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  )
}

export default RegisterPage
