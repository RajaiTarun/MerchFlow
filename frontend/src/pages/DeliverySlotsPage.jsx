import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { useClubContext } from '../useClubContext.js'
import ClubPicker from '../ClubPicker.jsx'

function DeliverySlotsPage() {
  const { token, user } = useAuth()
  const clubContext = useClubContext(token, user)
  const { resolvedClubId } = clubContext

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [slotInputs, setSlotInputs] = useState({})
  const [slotMessage, setSlotMessage] = useState({})

  function fetchItems() {
    if (!resolvedClubId) return
    setLoading(true)
    apiFetch(`/catalog?clubId=${resolvedClubId}`, { token })
      .then((data) => setItems(data.items))
      .catch((err) => setError(err.body?.error || err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, resolvedClubId])

  function updateSlotInput(itemId, field, value) {
    setSlotInputs((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [field]: value },
    }))
  }

  async function setSlot(itemId) {
    const input = slotInputs[itemId] || {}
    setSlotMessage((prev) => ({ ...prev, [itemId]: null }))

    try {
      await apiFetch(`/catalog/${itemId}/delivery-slot`, {
        method: 'PUT',
        token,
        body: {
          date: input.date,
          startTime: input.startTime,
          endTime: input.endTime,
        },
      })
      setSlotMessage((prev) => ({ ...prev, [itemId]: 'Slot set.' }))
      fetchItems()
    } catch (err) {
      setSlotMessage((prev) => ({
        ...prev,
        [itemId]: err.body?.error || err.message,
      }))
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">Items &amp; Delivery Slots</h2>
      <ClubPicker {...clubContext} />

      {!resolvedClubId ? (
        <p>Select a club above to manage its items.</p>
      ) : (
        <>
          {loading && <p>Loading...</p>}
          {error && <p className="text-red-600">Failed to load items. {error}</p>}
          {!loading && !error && items.length === 0 && <p>No items for this club yet.</p>}
          {!loading && !error && items.length > 0 && (
            <ul className="flex flex-col gap-4">
              {items.map((item) => (
                <li key={item._id} className="border border-gray-200 rounded p-3">
                  <p className="font-medium mb-1">{item.name}</p>
                  {item.deliverySlot?.date ? (
                    <p className="text-sm text-gray-600 mb-2">
                      Current slot: {item.deliverySlot.date}, {item.deliverySlot.startTime}–
                      {item.deliverySlot.endTime}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-600 mb-2">No delivery slot set yet.</p>
                  )}
                  <div className="flex gap-2 items-end flex-wrap">
                    <div>
                      <label className="block text-xs mb-1">Date</label>
                      <input
                        type="date"
                        onChange={(e) => updateSlotInput(item._id, 'date', e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1"
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1">Start</label>
                      <input
                        type="time"
                        onChange={(e) => updateSlotInput(item._id, 'startTime', e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1"
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1">End</label>
                      <input
                        type="time"
                        onChange={(e) => updateSlotInput(item._id, 'endTime', e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1"
                      />
                    </div>
                    <button
                      onClick={() => setSlot(item._id)}
                      className="border border-gray-300 rounded px-3 py-1 hover:bg-gray-100"
                    >
                      Set Slot
                    </button>
                  </div>
                  {slotMessage[item._id] && (
                    <p className="text-sm mt-1">{slotMessage[item._id]}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

export default DeliverySlotsPage
