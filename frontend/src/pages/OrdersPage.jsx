import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function OrdersPage() {
  const { token } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch('/orders', { token })
      .then((data) => setOrders(data.orders))
      .catch((err) => setError(err.body?.error || err.message))
      .finally(() => setLoading(false))
  }, [token])

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">My Orders</h2>
      {loading && <p>Loading...</p>}
      {error && <p className="text-red-600">Failed to load orders. {error}</p>}
      {!loading && !error && orders.length === 0 && (
        <p>You haven&apos;t placed any orders yet.</p>
      )}
      {!loading && !error && orders.length > 0 && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left border-b border-gray-300">
              <th className="py-2 pr-2">Item</th>
              <th className="py-2 pr-2">Size</th>
              <th className="py-2 pr-2">Qty</th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2">Placed</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b border-gray-200">
                <td className="py-2 pr-2">
                  <Link
                    to={`/catalog/${order.catalog_item_id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {order.item_name || 'View item'}
                  </Link>
                </td>
                <td className="py-2 pr-2">{order.selected_size || '-'}</td>
                <td className="py-2 pr-2">{order.quantity}</td>
                <td className="py-2 pr-2">{order.status}</td>
                <td className="py-2">
                  {new Date(order.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default OrdersPage
