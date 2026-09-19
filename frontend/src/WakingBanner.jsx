import { useSyncExternalStore } from 'react'
import { isWaking, subscribeToWaking } from './api.js'

function WakingBanner() {
  const waking = useSyncExternalStore(subscribeToWaking, isWaking)
  if (!waking) return null

  return (
    <div role="status" className="bg-amber-100 text-amber-900 text-sm px-4 py-2 text-center">
      The server was idle and is waking up (this can take up to a minute). Retrying automatically
      in 30 seconds...
    </div>
  )
}

export default WakingBanner
