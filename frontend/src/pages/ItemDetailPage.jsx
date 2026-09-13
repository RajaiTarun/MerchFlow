import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

const MAX_RETRIES = 3
const STOCK_POLL_INTERVAL_MS = 10000

function ItemDetailPage() {
  const { id } = useParams()
  const { token, user } = useAuth()

  const [item, setItem] = useState(null)
  const [preferredSize, setPreferredSize] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [selectedSize, setSelectedSize] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [mockCardNumber, setMockCardNumber] = useState('')

  // IDLE | PLACING_ORDER | RETRYING | SUCCESS | OUT_OF_STOCK | FAILED
  const [status, setStatus] = useState('IDLE')
  const [checkoutMessage, setCheckoutMessage] = useState(null)
  const [order, setOrder] = useState(null)
  const [retryAttempt, setRetryAttempt] = useState(0)

  useEffect(() => {
    setLoading(true)
    setLoadError(null)

    Promise.all([
      apiFetch(`/catalog/${id}`, { token }),
      apiFetch(`/users/profile/${user.sub}`, { token }),
    ])
      .then(([itemData, profileData]) => {
        setItem(itemData.item)
        setPreferredSize(profileData.user.preferred_size)

        const sizes = itemData.item.availableSizes || []
        if (
          sizes.length > 0 &&
          profileData.user.preferred_size &&
          sizes.includes(profileData.user.preferred_size)
        ) {
          setSelectedSize(profileData.user.preferred_size)
        }
      })
      .catch((err) => setLoadError(err.body?.error || err.message))
      .finally(() => setLoading(false))
  }, [id, token, user.sub])

  // Refetches just the stock count - used both by the periodic poll below and
  // right after a successful order, so the number on screen doesn't stay
  // stuck at whatever it was when the page first loaded. This is purely a
  // display refresh: the backend's atomic stock check at checkout time is
  // what actually prevents overselling, regardless of what's shown here.
  function refreshStock() {
    apiFetch(`/catalog/${id}`, { token })
      .then((data) => setItem(data.item))
      .catch(() => {}) // a failed background refresh isn't worth surfacing an error for
  }

  useEffect(() => {
    const intervalId = setInterval(refreshStock, STOCK_POLL_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [id, token])

  const hasSizes = item?.availableSizes?.length > 0
  const preferredAvailable =
    hasSizes && preferredSize && item.availableSizes.includes(preferredSize)
  const needsManualSize = hasSizes && !preferredAvailable

  async function handleSubmit(e) {
    e.preventDefault()

    if (hasSizes && !selectedSize) {
      setCheckoutMessage('Please select a size.')
      return
    }

    const idempotencyKey = crypto.randomUUID()
    setStatus('PLACING_ORDER')
    setCheckoutMessage(null)
    setRetryAttempt(0)

    const body = { catalogItemId: id, quantity, mockCardNumber }
    if (hasSizes) {
      body.selectedSize = selectedSize
    }

    let attempts = 0
    while (attempts < MAX_RETRIES) {
      try {
        const data = await apiFetch('/orders', {
          method: 'POST',
          token,
          body,
          headers: { 'Idempotency-Key': idempotencyKey },
        })
        setStatus('SUCCESS')
        setOrder(data.order)
        refreshStock()
        return
      } catch (err) {
        const code = err.body?.error

        // Lock contention / rate limiting - wait and automatically retry with
        // the SAME idempotency key, since this is still the same logical attempt.
        if (code === 'LOCK_CONTENTION_DETECTED' || code === 'RATE_LIMITED') {
          attempts++
          setRetryAttempt(attempts)
          setStatus('RETRYING')
          const waitMs = (Number(err.retryAfter) || 1) * 1000 + Math.random() * 300
          await new Promise((resolve) => setTimeout(resolve, waitMs))
          continue
        }

        if (code === 'OUT_OF_STOCK') {
          setStatus('OUT_OF_STOCK')
          setCheckoutMessage('This item is out of stock.')
          return
        }

        if (code === 'PAYMENT_FAILED') {
          setStatus('FAILED')
          setCheckoutMessage(
            'Payment failed (mock card was not 4242). Saga rollback restored the reserved stock.',
          )
          return
        }

        // Nothing was ever reserved on this path - treat a resubmit as a
        // brand-new checkout attempt (new idempotency key next time), not a retry.
        if (
          code === 'PREFERRED_SIZE_UNAVAILABLE' ||
          code === 'SELECTED_SIZE_UNAVAILABLE' ||
          code === 'NO_PREFERRED_SIZE'
        ) {
          setStatus('IDLE')
          setSelectedSize('')
          setCheckoutMessage('That size is not available. Please select one below.')
          return
        }

        setStatus('FAILED')
        setCheckoutMessage(err.body?.error || err.message)
        return
      }
    }

    setStatus('FAILED')
    setCheckoutMessage('Checkout failed after multiple retries. Please try again.')
  }

  if (loading) return <p>Loading...</p>
  if (loadError) {
    return <p className="text-red-600">Failed to load item. {loadError}</p>
  }
  if (!item) return null

  return (
    <div className="max-w-lg">
      <h2 className="text-xl font-semibold mb-2">{item.name}</h2>
      <p className="text-gray-600 mb-2">{item.description}</p>
      <p className="mb-1">Price: ₹{item.price}</p>
      <p className="mb-4">Stock: {item.stock}</p>

      {item.deliverySlot?.date && (
        <p className="mb-4 text-sm text-gray-600">
          Delivery: {item.deliverySlot.date}, {item.deliverySlot.startTime}–
          {item.deliverySlot.endTime}
        </p>
      )}

      {status === 'SUCCESS' ? (
        <div className="border border-green-300 bg-green-50 rounded p-4">
          <p className="mb-2">
            Order placed successfully! (status: {order?.status})
          </p>
          <Link to="/orders" className="text-blue-600 hover:underline">
            View it in your orders
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {hasSizes && (
            <div>
              <p className="text-sm font-medium mb-1">Size</p>
              {needsManualSize && (
                <p className="text-red-600 text-sm mb-2">
                  Your saved size{preferredSize ? ` (${preferredSize})` : ''} is
                  unavailable for this item. Please choose one below.
                </p>
              )}
              <div className="flex gap-3">
                {item.availableSizes.map((size) => (
                  <label key={size} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="size"
                      value={size}
                      checked={selectedSize === size}
                      onChange={(e) => setSelectedSize(e.target.value)}
                    />
                    {size}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="quantity" className="block text-sm font-medium mb-1">
              Quantity
            </label>
            <input
              id="quantity"
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="border border-gray-300 rounded px-3 py-2 w-24"
            />
          </div>

          <div>
            <label htmlFor="mockCardNumber" className="block text-sm font-medium mb-1">
              Mock Payment Card
            </label>
            <input
              id="mockCardNumber"
              type="text"
              value={mockCardNumber}
              onChange={(e) => setMockCardNumber(e.target.value)}
              placeholder="4242 = success, anything else = failure"
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>

          {status === 'RETRYING' && (
            <p className="text-sm text-gray-600">
              Retrying... (attempt {retryAttempt} of {MAX_RETRIES})
            </p>
          )}
          {checkoutMessage && (
            <p className="text-red-600 text-sm">{checkoutMessage}</p>
          )}

          <button
            type="submit"
            disabled={status === 'PLACING_ORDER' || status === 'RETRYING'}
            className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
          >
            {status === 'PLACING_ORDER' || status === 'RETRYING'
              ? 'Placing order...'
              : 'Place Order'}
          </button>
        </form>
      )}
    </div>
  )
}

export default ItemDetailPage
