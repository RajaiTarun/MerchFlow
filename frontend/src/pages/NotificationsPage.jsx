import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

const NOTIFICATION_POLL_INTERVAL_MS = 15000

function NotificationsPage() {
  const { token } = useAuth()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  function fetchNotifications() {
    apiFetch('/notifications', { token })
      .then((data) => setNotifications(data.notifications))
      .catch((err) => setError(err.body?.error || err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchNotifications()
  }, [token])

  // Approximates "real-time" - the backend has no WebSocket/SSE endpoint, so
  // this is the simplest honest way to notice new notifications while this
  // page is open.
  useEffect(() => {
    const intervalId = setInterval(fetchNotifications, NOTIFICATION_POLL_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [token])

  async function markRead(id) {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: 'PATCH', token })
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      )
    } catch (err) {
      setError(err.body?.error || err.message)
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">Notifications</h2>
      {loading && <p>Loading...</p>}
      {error && <p className="text-red-600">Failed to load notifications. {error}</p>}
      {!loading && !error && notifications.length === 0 && <p>No notifications yet.</p>}
      {!loading && !error && notifications.length > 0 && (
        <ul className="flex flex-col gap-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              className={`border border-gray-200 rounded p-3 flex justify-between items-center gap-3 ${
                n.is_read ? '' : 'bg-blue-50 font-medium'
              }`}
            >
              <div>
                <p>{n.message}</p>
                <p className="text-xs text-gray-500">
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </div>
              {!n.is_read && (
                <button
                  onClick={() => markRead(n.id)}
                  className="text-sm border border-gray-300 rounded px-2 py-1 hover:bg-gray-100 shrink-0"
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default NotificationsPage
