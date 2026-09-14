import { useState } from 'react'
import { apiFetch } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { useClubContext } from '../useClubContext.js'
import ClubPicker from '../ClubPicker.jsx'

const ITEM_TYPES = ['APPAREL', 'MUG', 'ACCESSORY']

function CreateItemPage() {
  const { token, user } = useAuth()
  const clubContext = useClubContext(token, user)
  const { isSuperAdmin, resolvedClubId } = clubContext

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('')
  const [type, setType] = useState('APPAREL')
  const [sizesText, setSizesText] = useState('')
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  const showSizes = type === 'APPAREL' || type === 'ACCESSORY'

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)

    const body = {
      name,
      description,
      price: Number(price),
      stock: Number(stock),
      type,
    }
    if (showSizes && sizesText.trim()) {
      body.availableSizes = sizesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    // Club Admin's club is derived from their own JWT on the backend - only
    // Super Admin needs to say which club this item belongs to.
    if (isSuperAdmin) {
      body.clubId = resolvedClubId
    }

    try {
      const data = await apiFetch('/catalog', { method: 'POST', token, body })
      setMessage(`Created "${data.item.name}".`)
      setName('')
      setDescription('')
      setPrice('')
      setStock('')
      setSizesText('')
    } catch (err) {
      setError(err.body?.error || err.message)
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">Create Item</h2>
      <ClubPicker {...clubContext} />

      {!resolvedClubId ? (
        <p>Select a club above to create an item for it.</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-sm">
          <div>
            <label htmlFor="itemName" className="block text-sm font-medium mb-1">
              Name
            </label>
            <input
              id="itemName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="itemDescription" className="block text-sm font-medium mb-1">
              Description
            </label>
            <input
              id="itemDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="itemPrice" className="block text-sm font-medium mb-1">
              Price
            </label>
            <input
              id="itemPrice"
              type="number"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="itemStock" className="block text-sm font-medium mb-1">
              Stock
            </label>
            <input
              id="itemStock"
              type="number"
              min="0"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="itemType" className="block text-sm font-medium mb-1">
              Type
            </label>
            <select
              id="itemType"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1"
            >
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {showSizes && (
            <div>
              <label htmlFor="itemSizes" className="block text-sm font-medium mb-1">
                Available sizes{' '}
                {type === 'APPAREL'
                  ? '(required, comma-separated, e.g. S,M,L)'
                  : '(optional, comma-separated)'}
              </label>
              <input
                id="itemSizes"
                value={sizesText}
                onChange={(e) => setSizesText(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </div>
          )}
          {error && <p className="text-red-600 text-sm">{error}</p>}
          {message && <p className="text-green-700 text-sm">{message}</p>}
          <button
            type="submit"
            className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700 w-fit"
          >
            Create
          </button>
        </form>
      )}
    </div>
  )
}

export default CreateItemPage
