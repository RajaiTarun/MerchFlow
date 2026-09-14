import { useState } from 'react'
import { apiFetch } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function CreateClubPage() {
  const { token } = useAuth()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setResult(null)

    try {
      const data = await apiFetch('/clubs', {
        method: 'POST',
        token,
        body: { name, description, admin_email: adminEmail },
      })
      setResult(data)
      setName('')
      setDescription('')
      setAdminEmail('')
    } catch (err) {
      setError(err.body?.error || err.message)
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">Create Club</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-sm">
        <div>
          <label htmlFor="clubName" className="block text-sm font-medium mb-1">
            Club name
          </label>
          <input
            id="clubName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full border border-gray-300 rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="clubDescription" className="block text-sm font-medium mb-1">
            Description
          </label>
          <input
            id="clubDescription"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="clubAdminEmail" className="block text-sm font-medium mb-1">
            Club Admin email
          </label>
          <input
            id="clubAdminEmail"
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            required
            className="w-full border border-gray-300 rounded px-3 py-2"
          />
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {result && (
          <p className="text-green-700 text-sm">
            Created &quot;{result.club.name}&quot; with {result.admin.email} as admin.
          </p>
        )}
        <button
          type="submit"
          className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700 w-fit"
        >
          Create Club
        </button>
      </form>
    </div>
  )
}

export default CreateClubPage
