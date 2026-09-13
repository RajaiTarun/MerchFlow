import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

const TYPES = ['APPAREL', 'MUG', 'ACCESSORY']

function buildQuery({ type, clubId, cursor }) {
  const params = new URLSearchParams()
  if (type) params.set('type', type)
  if (clubId) params.set('clubId', clubId)
  if (cursor) params.set('cursor', cursor)
  return params.toString()
}

function CatalogPage() {
  const { token } = useAuth()
  const [items, setItems] = useState([])
  const [clubs, setClubs] = useState([])
  const [type, setType] = useState('')
  const [clubId, setClubId] = useState('')
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Fetched once - used both for the club filter dropdown and to show a
  // readable club name instead of a raw clubId in the table.
  useEffect(() => {
    apiFetch('/clubs', { token }).then((data) => setClubs(data.clubs))
  }, [token])

  // Re-runs whenever a filter changes, replacing the list from scratch -
  // this is what "resets pagination" when a filter changes.
  useEffect(() => {
    setLoading(true)
    setError(null)

    apiFetch(`/catalog?${buildQuery({ type, clubId })}`, { token })
      .then((data) => {
        setItems(data.items)
        setNextCursor(data.nextCursor)
      })
      .catch((err) => setError(err.body?.error || err.message))
      .finally(() => setLoading(false))
  }, [token, type, clubId])

  async function loadMore() {
    try {
      const data = await apiFetch(
        `/catalog?${buildQuery({ type, clubId, cursor: nextCursor })}`,
        { token },
      )
      setItems((prev) => [...prev, ...data.items])
      setNextCursor(data.nextCursor)
    } catch (err) {
      setError(err.body?.error || err.message)
    }
  }

  function clubName(id) {
    return clubs.find((c) => c.id === id)?.name || id
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Catalog</h2>

      <div className="flex gap-3 mb-4">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1"
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={clubId}
          onChange={(e) => setClubId(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1"
        >
          <option value="">All clubs</option>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {loading && <p>Loading...</p>}
      {error && <p className="text-red-600">Failed to load catalog. {error}</p>}
      {!loading && !error && items.length === 0 && (
        <p>No merchandise available yet.</p>
      )}

      {!loading && !error && items.length > 0 && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left border-b border-gray-300">
              <th className="py-2 pr-2">Name</th>
              <th className="py-2 pr-2">Type</th>
              <th className="py-2 pr-2">Club</th>
              <th className="py-2 pr-2">Price</th>
              <th className="py-2">Stock</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item._id} className="border-b border-gray-200">
                <td className="py-2 pr-2">
                  <Link
                    to={`/catalog/${item._id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {item.name}
                  </Link>
                </td>
                <td className="py-2 pr-2">{item.type}</td>
                <td className="py-2 pr-2">{clubName(item.clubId)}</td>
                <td className="py-2 pr-2">₹{item.price}</td>
                <td className="py-2">{item.stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {nextCursor && (
        <button
          onClick={loadMore}
          className="mt-4 border border-gray-300 rounded px-4 py-2 hover:bg-gray-100"
        >
          Load More
        </button>
      )}
    </div>
  )
}

export default CatalogPage
