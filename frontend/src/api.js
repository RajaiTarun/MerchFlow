const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1'

export async function apiFetch(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const error = new Error(data.error || 'Request failed')
    error.status = res.status
    error.body = data
    error.retryAfter = res.headers.get('Retry-After')
    throw error
  }

  return data
}
