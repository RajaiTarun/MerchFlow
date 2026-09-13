import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

const SIZES = ['S', 'M', 'L', 'XL', 'XXL']

function ProfilePage() {
  const { token, user } = useAuth()
  const userId = user.sub

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [hostelBlock, setHostelBlock] = useState('')
  const [preferredSize, setPreferredSize] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saveMessage, setSaveMessage] = useState(null)

  useEffect(() => {
    apiFetch(`/users/profile/${userId}`, { token })
      .then((data) => {
        const u = data.user
        setFullName(u.full_name || '')
        setPhone(u.phone || '')
        setHostelBlock(u.hostel_block || '')
        setPreferredSize(u.preferred_size || '')
      })
      .catch((err) => setError(err.body?.error || err.message))
      .finally(() => setLoading(false))
  }, [token, userId])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaveMessage(null)
    setError(null)

    // Only send fields that actually have a value - matches the backend's
    // "at least one field, partial update" contract for PUT /users/profile.
    const body = {}
    if (fullName) body.full_name = fullName
    if (phone) body.phone = phone
    if (hostelBlock) body.hostel_block = hostelBlock
    if (preferredSize) body.preferred_size = preferredSize

    try {
      await apiFetch('/users/profile', { method: 'PUT', token, body })
      setSaveMessage('Profile updated.')
    } catch (err) {
      setError(err.body?.error || err.message)
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">Profile</h2>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-sm">
          <div>
            <label htmlFor="fullName" className="block text-sm font-medium mb-1">
              Full name
            </label>
            <input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="phone" className="block text-sm font-medium mb-1">
              Phone
            </label>
            <input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="hostelBlock" className="block text-sm font-medium mb-1">
              Hostel block
            </label>
            <input
              id="hostelBlock"
              value={hostelBlock}
              onChange={(e) => setHostelBlock(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="preferredSize" className="block text-sm font-medium mb-1">
              Preferred size
            </label>
            <select
              id="preferredSize"
              value={preferredSize}
              onChange={(e) => setPreferredSize(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1"
            >
              <option value="">None saved</option>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          {saveMessage && <p className="text-green-700 text-sm">{saveMessage}</p>}
          <button
            type="submit"
            className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700 w-fit"
          >
            Save
          </button>
        </form>
      )}
    </div>
  )
}

export default ProfilePage
