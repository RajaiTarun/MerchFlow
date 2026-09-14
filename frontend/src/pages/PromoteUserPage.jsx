import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

const ROLES = ['STUDENT', 'CLUB_ADMIN', 'SUPER_ADMIN']

function PromoteUserPage() {
  const { token } = useAuth()
  const [clubs, setClubs] = useState([])

  useEffect(() => {
    apiFetch('/clubs', { token }).then((data) => setClubs(data.clubs))
  }, [token])

  const [email, setEmail] = useState('')
  const [foundUser, setFoundUser] = useState(null)
  const [lookupError, setLookupError] = useState(null)
  const [newRole, setNewRole] = useState('CLUB_ADMIN')
  const [newClubId, setNewClubId] = useState('')
  const [updateMessage, setUpdateMessage] = useState(null)
  const [updateError, setUpdateError] = useState(null)

  async function handleLookup(e) {
    e.preventDefault()
    setLookupError(null)
    setFoundUser(null)
    setUpdateMessage(null)
    setUpdateError(null)

    try {
      const data = await apiFetch(`/users/lookup?email=${encodeURIComponent(email)}`, {
        token,
      })
      setFoundUser(data.user)
    } catch (err) {
      setLookupError(err.body?.error || err.message)
    }
  }

  async function handleUpdateRole(e) {
    e.preventDefault()
    setUpdateMessage(null)
    setUpdateError(null)

    const body = { role: newRole }
    if (newRole === 'CLUB_ADMIN') {
      body.club_id = newClubId
    }

    try {
      const data = await apiFetch(`/users/${foundUser.id}/role`, {
        method: 'PUT',
        token,
        body,
      })
      setUpdateMessage(`${data.user.email} is now ${data.user.role}.`)
      setFoundUser(data.user)
    } catch (err) {
      setUpdateError(err.body?.error || err.message)
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">Manage a User's Role</h2>
      <form onSubmit={handleLookup} className="flex gap-2 items-end mb-3">
        <div>
          <label htmlFor="lookupEmail" className="block text-sm font-medium mb-1">
            Email
          </label>
          <input
            id="lookupEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="border border-gray-300 rounded px-3 py-2"
          />
        </div>
        <button
          type="submit"
          className="border border-gray-300 rounded px-3 py-2 hover:bg-gray-100"
        >
          Find
        </button>
      </form>
      {lookupError && <p className="text-red-600 text-sm mb-3">{lookupError}</p>}

      {foundUser && (
        <div className="border border-gray-200 rounded p-3 max-w-sm">
          <p className="mb-1">
            {foundUser.full_name || foundUser.email} ({foundUser.email})
          </p>
          <p className="text-sm text-gray-600 mb-3">Current role: {foundUser.role}</p>

          {foundUser.club_id && (
            <p className="text-red-600 text-sm mb-3">
              This user is already assigned to a club. To move them to a different
              club, set their role to STUDENT here first, then look them up again
              and assign the new club.
            </p>
          )}

          <form onSubmit={handleUpdateRole} className="flex flex-col gap-3">
            <div>
              <label htmlFor="newRole" className="block text-sm font-medium mb-1">
                New role
              </label>
              <select
                id="newRole"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            {newRole === 'CLUB_ADMIN' && (
              <div>
                <label htmlFor="newClub" className="block text-sm font-medium mb-1">
                  Club
                </label>
                <select
                  id="newClub"
                  value={newClubId}
                  onChange={(e) => setNewClubId(e.target.value)}
                  required
                  className="border border-gray-300 rounded px-2 py-1"
                >
                  <option value="">Select a club</option>
                  {clubs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {updateError && <p className="text-red-600 text-sm">{updateError}</p>}
            {updateMessage && <p className="text-green-700 text-sm">{updateMessage}</p>}
            <button
              type="submit"
              className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700 w-fit"
            >
              Update Role
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

export default PromoteUserPage
