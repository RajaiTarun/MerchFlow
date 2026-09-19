const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1'

// Render's free plan puts idle services to sleep, and its own docs put the
// worst-case wake-up at ~50s. Retrying immediately (or every few seconds) just
// piles requests onto a service that is still booting, so wait 30s between
// tries. Two retries cover 60s in total, i.e. the whole worst-case window.
const IDLE_RETRY_DELAY_MS = 30000
const IDLE_MAX_RETRIES = 2

// 502/503: the gateway or Render's proxy couldn't reach a sleeping service, so
// the request never got processed. 504 is different - the upstream may have
// received it - so it is only replayed when that's harmless (see below).
const SERVICE_UNREACHABLE_STATUSES = [502, 503]

// A 429 is ambiguous. The gateway's own rate limiter always answers with
// { error: 'RATE_LIMITED' } (and callers like checkout handle that themselves).
// A 429 with NO error body comes from Render's edge instead: it is what a
// hibernating service returns when requests reach it while it's still waking
// (the "hibernate" response header seen in the browser). Hammering it just
// earns more 429s, which is the failure this whole retry policy exists to avoid.
function isRenderWakeRateLimit(status, data) {
  return status === 429 && !data.error
}

// Tiny external store so a banner can show while any request is waiting to
// retry. A counter (not a boolean) because several requests can be waiting
// at once, e.g. a page that loads an item and a profile in parallel.
let waitingCount = 0
const wakeListeners = new Set()

function changeWaiting(delta) {
  waitingCount += delta
  wakeListeners.forEach((listener) => listener())
}

export function subscribeToWaking(listener) {
  wakeListeners.add(listener)
  return () => wakeListeners.delete(listener)
}

export function isWaking() {
  return waitingCount > 0
}

async function waitBeforeIdleRetry() {
  changeWaiting(1)
  try {
    await new Promise((resolve) => setTimeout(resolve, IDLE_RETRY_DELAY_MS))
  } finally {
    changeWaiting(-1)
  }
}

// `retryOnIdle: false` is for background polls, which already repeat on their
// own and would only stack extra requests behind the one that's waiting.
export async function apiFetch(
  path,
  { method = 'GET', body, token, headers = {}, retryOnIdle = true } = {},
) {
  // Replaying is only harmless for reads and for requests carrying an
  // Idempotency-Key (the server de-duplicates those).
  const safeToReplay = method === 'GET' || 'Idempotency-Key' in headers

  for (let attempt = 0; ; attempt++) {
    const canRetry = retryOnIdle && attempt < IDLE_MAX_RETRIES
    let res

    try {
      res = await fetch(BASE_URL + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (err) {
      // fetch only rejects when no response arrived at all. While a service
      // wakes, Render's own 503 carries no CORS headers, so the browser
      // reports it as this same network error.
      if (canRetry) {
        await waitBeforeIdleRetry()
        continue
      }
      throw err
    }

    const data = await res.json().catch(() => ({}))

    const serviceAsleep =
      SERVICE_UNREACHABLE_STATUSES.includes(res.status) ||
      isRenderWakeRateLimit(res.status, data) ||
      (res.status === 504 && safeToReplay)
    if (serviceAsleep && canRetry) {
      await waitBeforeIdleRetry()
      continue
    }

    if (!res.ok) {
      const fallback = serviceAsleep
        ? 'The server is still waking up. Please try again in a minute.'
        : 'Request failed'
      const error = new Error(data.error || fallback)
      error.status = res.status
      error.body = data
      error.retryAfter = res.headers.get('Retry-After')
      throw error
    }

    return data
  }
}
