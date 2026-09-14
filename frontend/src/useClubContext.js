import { useEffect, useState } from 'react'
import { apiFetch } from './api.js'

// Shared by every admin page that needs to know "which club am I managing
// right now" - Super Admin picks one from a dropdown, Club Admin's is fixed
// to their own club from the JWT. Pulled into one hook because three separate
// pages (Create Item, Delivery Slots, Club Orders) need this identical logic,
// not because it's used once.
export function useClubContext(token, user) {
  const isSuperAdmin = user.role === 'SUPER_ADMIN'
  const [clubs, setClubs] = useState([])
  const [selectedClubId, setSelectedClubId] = useState('')

  useEffect(() => {
    apiFetch('/clubs', { token }).then((data) => setClubs(data.clubs))
  }, [token])

  const resolvedClubId = isSuperAdmin ? selectedClubId : user.clubId
  const resolvedClubName = clubs.find((c) => c.id === resolvedClubId)?.name

  return {
    clubs,
    isSuperAdmin,
    selectedClubId,
    setSelectedClubId,
    resolvedClubId,
    resolvedClubName,
  }
}
