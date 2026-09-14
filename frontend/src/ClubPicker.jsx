// Renders whatever useClubContext() produced: a dropdown for Super Admin,
// or read-only text for Club Admin.
function ClubPicker({ isSuperAdmin, clubs, selectedClubId, setSelectedClubId, resolvedClubName }) {
  if (!isSuperAdmin) {
    return <p className="mb-4">Managing: {resolvedClubName || 'your club'}</p>
  }

  return (
    <div className="mb-4">
      <label htmlFor="clubSelect" className="block text-sm font-medium mb-1">
        Acting as club
      </label>
      <select
        id="clubSelect"
        value={selectedClubId}
        onChange={(e) => setSelectedClubId(e.target.value)}
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
  )
}

export default ClubPicker
