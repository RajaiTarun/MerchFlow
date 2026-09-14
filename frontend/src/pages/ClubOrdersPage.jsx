import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { useClubContext } from '../useClubContext.js'
import ClubPicker from '../ClubPicker.jsx'

function ClubOrdersPage() {
  const { token, user } = useAuth()
  const clubContext = useClubContext(token, user)
  const { isSuperAdmin, resolvedClubId } = clubContext

  const [orders, setOrders] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!resolvedClubId) return
    setLoading(true)
    setError(null)

    const query = isSuperAdmin ? `?clubId=${resolvedClubId}` : ''
    Promise.all([
      apiFetch(`/orders/club${query}`, { token }),
      // The club's own item list, fetched here too, purely so order rows can
      // show a real item name instead of a raw catalog_item_id - GET /orders/club
      // doesn't return item names itself.
      apiFetch(`/catalog?clubId=${resolvedClubId}`, { token }),
    ])
      .then(([ordersData, itemsData]) => {
        setOrders(ordersData.orders)
        setItems(itemsData.items)
      })
      .catch((err) => setError(err.body?.error || err.message))
      .finally(() => setLoading(false))
  }, [token, resolvedClubId, isSuperAdmin])

  function itemName(catalogItemId) {
    return items.find((i) => i._id === catalogItemId)?.name || catalogItemId
  }

  async function markDelivered(orderId) {
    try {
      await apiFetch(`/orders/${orderId}/status`, {
        method: 'PATCH',
        token,
        body: { status: 'DELIVERED' },
      })
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: 'DELIVERED' } : o)),
      )
    } catch (err) {
      setError(err.body?.error || err.message)
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">Club Orders</h2>
      <ClubPicker {...clubContext} />

      {!resolvedClubId ? (
        <p>Select a club above to view its orders.</p>
      ) : (
        <>
          {loading && <p>Loading...</p>}
          {error && <p className="text-red-600">Failed to load orders. {error}</p>}
          {!loading && !error && orders.length === 0 && <p>No orders for this club yet.</p>}
          {!loading && !error && orders.length > 0 && (
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left border-b border-gray-300">
                  <th className="py-2 pr-2">Item</th>
                  <th className="py-2 pr-2">Student</th>
                  <th className="py-2 pr-2">Size</th>
                  <th className="py-2 pr-2">Qty</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Placed</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-gray-200">
                    <td className="py-2 pr-2">{itemName(order.catalog_item_id)}</td>
                    <td className="py-2 pr-2">{order.student_email || order.user_id}</td>
                    <td className="py-2 pr-2">{order.selected_size || '-'}</td>
                    <td className="py-2 pr-2">{order.quantity}</td>
                    <td className="py-2 pr-2">{order.status}</td>
                    <td className="py-2 pr-2">
                      {new Date(order.created_at).toLocaleString()}
                    </td>
                    <td className="py-2">
                      {order.status === 'COMMITTED' && (
                        <button
                          onClick={() => markDelivered(order.id)}
                          className="text-sm border border-gray-300 rounded px-2 py-1 hover:bg-gray-100"
                        >
                          Mark Delivered
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

export default ClubOrdersPage
