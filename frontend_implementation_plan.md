# CCMMS Frontend Implementation Plan

**Status:** Planning only. No frontend code has been written yet.

**Read this first:** `docs/FRONTEND_SPEC_DOCUMENT.md` already exists in this repo and describes a much more elaborate frontend (Tailwind, Zustand, TanStack Query, Axios interceptors, a "System Design Live-Telemetry Drawer", a Super Admin health/circuit-breaker panel). That document was written before the current instructions and **does not match either the actual backend or the current goal of a minimal, beginner-friendly demo client.** This plan supersedes it. Where the two disagree, follow this plan. Reasons for every deviation are called out inline below.

---

## 0. Philosophy Recap (why this plan looks the way it does)

CCMMS is a backend/distributed-systems portfolio project. The frontend's only job is to prove the backend works, in the plainest possible code. Priority order: **correctness > simplicity > understandability > maintainability > functionality > looks.**

Concretely, that means:
- Plain React + Vite + plain CSS. No Tailwind, no component library, no CSS-in-JS.
- `fetch`, not Axios — no interceptor abstraction to learn.
- Local `useState` everywhere except the one thing that's genuinely global (the logged-in user/JWT), which gets a single React Context.
- No Redux/Zustand, no TanStack Query, no WebSockets/SSE (the backend doesn't have any anyway — see below).
- Few files. Pages are allowed to be a bit long (multiple `<section>`s in one file) rather than being split into many tiny components.
- One real exception to "keep it simple": the **checkout flow** (idempotency key, distributed lock, retry-after) is the single most important thing this project demonstrates, so it gets slightly more careful handling than everything else — but still as plain `if`/`while` logic, not a formal state machine library.

---

## 1. What Actually Exists in the Backend (verified by reading the code, not the docs)

**Architecture:** 5 independent Node/Express processes, started together via `npm run dev` (root) using `concurrently`:

| Service | Port | Datastore | Responsibility |
|---|---|---|---|
| api-gateway | 3000 | — | Single public entry point. Auth, RBAC, rate limiting, proxies everything else. |
| user-service | 3001 | Postgres (Neon) | Register/login, profile, saved size, clubs list, role promotion |
| catalog-service | 3002 | MongoDB (Atlas) + Valkey cache | Merchandise items, stock, delivery slots |
| order-service | 3003 | Postgres + Valkey (locks/idempotency) | Checkout, orders, saga compensation |
| notification-service | 3004 | Postgres + RabbitMQ (CloudAMQP) | Consumes order/delivery events, exposes a notifications inbox |

**The frontend only ever talks to the gateway** (`http://localhost:3000`). It never calls a service port directly, and never sends `X-Internal-Service-Key` — the gateway injects that itself on every proxied request. Downstream services also trust an `Authorization: Bearer <jwt>` header set by the browser and a few gateway-injected trusted headers (`x-user-id`, `x-user-role`, `x-club-id`) that the frontend never needs to set itself.

**CORS** is wide open on the gateway (`app.use(cors())`), so a Vite dev server on a different port works with no extra config.

**Roles:** `STUDENT`, `CLUB_ADMIN` (tenant-scoped to one `clubId`), `SUPER_ADMIN` (bypasses every role/tenant check). JWT payload: `{ sub, email, role, clubId, iat, exp }`, 1-hour TTL, no refresh endpoint exists — expiry just means "log in again."

**Real-time notifications do not exist.** There is no WebSocket/SSE endpoint anywhere in the backend, despite `FRONTEND_SPEC_DOCUMENT.md` mentioning "live polling or SSE." The only option is a REST `GET /notifications` that the frontend polls on an interval. This plan uses `setInterval` polling, which is also the simplest option anyway.

**No circuit breaker, no `/health/detailed`, no queue-depth/connection-pool monitoring exists anywhere in the code** (`opossum` isn't even a dependency in any service's `package.json`). The "Super Admin Diagnostics Panel" described in the old spec document is aspirational documentation, not a real capability — see Section 4 for the recommendation to drop it.

---

## 2. Complete API Inventory (verified against the actual route files)

All paths below are relative to `http://localhost:3000/api/v1` unless marked "gateway root" or "internal only." "Auth" = requires `Authorization: Bearer <jwt>`.

### Auth & Users (user-service, via gateway)

| Feature | Method | Path | Auth | Role | Request body | Success | Key errors |
|---|---|---|---|---|---|---|---|
| Register | POST | `/users/register` | No | — | `{email, password, full_name?}` | `201 {message, user:{id,email,full_name,created_at}}` | `400` missing fields, `403` non-`@students.iiit.ac.in` email, `409` email taken |
| Login | POST | `/users/login` | No | — | `{email, password}` | `200 {message, token, user:{id,email,role,full_name}}` | `400` missing fields, `401` invalid credentials |
| Get profile | GET | `/users/profile/:userId` | Yes — own account only (fixed 2026-09-11, was previously unauthenticated) | own account only | — | `200 {user:{id,email,full_name,phone,hostel_block,preferred_size}}` | `401` no/invalid token, `403` requesting someone else's `:userId`, `404` not found |
| Update profile | PUT | `/users/profile` | Yes | own account only | `{full_name?, phone?, hostel_block?, preferred_size?}` (at least one) | `200 {message, user:{...}}` | `400` no fields / invalid size, `404` |
| Update size only | PUT | `/users/size` | Yes | own account only | `{preferred_size}` | `200 {message, user:{id,email,preferred_size}}` | `400` missing/invalid size, `404` — **not used by this plan**, `PUT /users/profile` already covers this field |
| List clubs | GET | `/clubs` | Yes | any | — | `200 {clubs:[{id,name,description,created_at}]}` | — |
| Create club + assign admin | POST | `/clubs` | Yes | `SUPER_ADMIN` only | `{name, description?, admin_email}` (added 2026-09-11) | `201 {message, club, admin:{id,email,full_name,role,club_id}}` | `400` missing fields / target already has a club / target is `SUPER_ADMIN`, `404` no user with that email, `409` club name already exists |
| Look up user by email | GET | `/users/lookup?email=` | Yes | `SUPER_ADMIN` only | — (added 2026-09-11) | `200 {user:{id,email,full_name,role,club_id}}` | `400` missing `email`, `404` not found |
| Promote user | PUT | `/users/:userId/role` | Yes | `SUPER_ADMIN` only | `{role: STUDENT\|CLUB_ADMIN\|SUPER_ADMIN, club_id?}` (`club_id` required iff role is `CLUB_ADMIN`) | `200 {message, user:{id,email,full_name,role,club_id}}` | `400` invalid role/club_id, `400` target already assigned to a club when promoting to `CLUB_ADMIN` (added 2026-09-11 — must be demoted first), `404` user not found |

Note: registration does **not** accept a `preferred_size` (unlike what the old spec implied). Size is set after registering, via the Profile page.

### Catalog (catalog-service, via gateway)

| Feature | Method | Path | Auth | Role | Request | Success | Key errors |
|---|---|---|---|---|---|---|---|
| Browse catalog | GET | `/catalog?cursor=&type=&clubId=` | Yes | any | query params optional | `200 {count, nextCursor, items:[Item]}` | — |
| Item detail | GET | `/catalog/:id` | Yes | any | — | `200 {item:Item}` | `404` |
| Create item | POST | `/catalog` | Yes | `CLUB_ADMIN` (own club, auto) / `SUPER_ADMIN` (must send `clubId` in body) | `{type: APPAREL\|MUG\|ACCESSORY, name, price, description?, stock?, availableSizes?, clubId? (SUPER_ADMIN only)}` (`availableSizes` required, non-empty, for `APPAREL`) | `201 {message, item}` | `400` missing fields / bad type / apparel needs sizes, `403` role, `404` bad clubId (super admin) |
| Set delivery slot | PUT | `/catalog/:itemId/delivery-slot` | Yes | `CLUB_ADMIN` (own item) / `SUPER_ADMIN` | `{date: YYYY-MM-DD, startTime: HH:MM, endTime: HH:MM}` | `200 {message, item}` | `400` bad format, `403` not your club's item, `404` |
| *Reserve stock* | PATCH | `/catalog/:id/stock` | **Internal only** — called by order-service during checkout | — | — | — | **Do not call from frontend** |
| *Rollback stock* | PATCH | `/catalog/:id/rollback` | **Internal only** | — | — | — | **Do not call from frontend** |
| *Commit reservation* | PATCH | `/catalog/:id/reservation/commit` | **Internal only** | — | — | — | **Do not call from frontend** |

`Item` shape: `{_id, name, type, description, price, clubId, stock, availableSizes, deliverySlot?, createdAt, updatedAt}`.

### Orders (order-service, via gateway)

| Feature | Method | Path | Auth | Role | Request | Success | Key errors |
|---|---|---|---|---|---|---|---|
| Checkout | POST | `/orders` | Yes | any authenticated role | Headers: `Idempotency-Key: <uuid>` (required). Body: `{catalogItemId, quantity=1, selectedSize?, mockCardNumber}` | `201 {message, order}` (or `200` on idempotent replay) | see full table in §8 |
| My orders | GET | `/orders` | Yes | any | — | `200 {orders:[{id,catalog_item_id,selected_size,quantity,status,created_at}]}` | — |
| Order detail | GET | `/orders/:id` | Yes | owner only | — | `200 {order}` | `403` not yours, `404`, `400` bad id |
| Club's orders | GET | `/orders/club?clubId=` | Yes | `CLUB_ADMIN` (own club, auto) / `SUPER_ADMIN` (`clubId` query param required) | — | `200 {orders:[{id,user_id,student_email,catalog_item_id,selected_size,quantity,status,created_at}]}` (`student_email` added 2026-09-14 — denormalized onto `orders` at checkout time so this route can show who placed an order without a cross-service lookup; see `migrate7.js`) | `403`, `400` |
| Mark delivered | PATCH | `/orders/:orderId/status` | Yes | `CLUB_ADMIN` (own club) / `SUPER_ADMIN` | `{status: "DELIVERED"}` (only value accepted; order must currently be `COMMITTED`) | `200 {message, order}` | `400` wrong current status, `403` not your club's order, `404` |
| *Users by item* | GET | `/orders/by-item/:catalogItemId/users` | **Internal only** — used by notification-service | — | — | — | **Do not call from frontend** |

Order `status` values that actually occur in practice: `COMMITTED` (payment succeeded) → `DELIVERED` (admin marked it). A failed payment (`mockCardNumber` ≠ `4242`) **never creates a database row at all** so `PAYMENT_FAILED` never actually appears in order history despite existing in the DB's `CHECK` constraint.

### Notifications (notification-service, via gateway)

| Feature | Method | Path | Auth | Role | Request | Success |
|---|---|---|---|---|---|---|
| My notifications | GET | `/notifications` | Yes | any | — | `200 {notifications:[{id,order_id,type,message,metadata,is_read,created_at}]}` |
| Mark read | PATCH | `/notifications/:id/read` | Yes | owner only | — | `200 {message, notification}` |

Notifications are created asynchronously by RabbitMQ consumers reacting to `order.placed`, `order.delivered`, and `delivery.slot.updated` events — there can be a short delay (typically well under a second, but not instant) between an action (checkout, admin marks delivered, admin sets a delivery slot) and the notification appearing. This is exactly why polling (not a single fetch) is used on the Notifications page.

### Gateway itself

| Feature | Method | Path | Auth |
|---|---|---|---|
| Gateway health | GET | `http://localhost:3000/health` | No |

This only reports the gateway process itself — it does **not** aggregate downstream service health (no such endpoint exists anywhere). See §4 and §12 for why the Super Admin "diagnostics panel" is dropped from scope.

---

## 3. Minimum User Flows

```
Authentication
  Register (@students.iiit.ac.in only) → 201
        ↓
  Login → JWT (1h TTL) → stored in localStorage
        ↓
  Authenticated app (Navbar shows role-appropriate links)
        ↓
  Logout → clear token → redirect to /login
```

```
Catalog Browsing
  Open /catalog → GET /catalog (cursor pagination, type/club filters)
        ↓
  Click an item → /catalog/:id → GET /catalog/:id
```

```
Checkout (the core distributed-systems demo)
  On /catalog/:id: fetch own profile's preferred_size, compare to item.availableSizes
        ↓
  Pre-select preferred size if available, else force manual pick
        ↓
  Enter quantity + mock card number ("4242" = success, anything else = simulated failure)
        ↓
  Click "Place Order" → generate ONE UUID → POST /orders with Idempotency-Key
        ↓
  201 → SUCCESS            409 LOCK_CONTENTION → auto-retry (same key)
  400 OUT_OF_STOCK/etc → FAILED   429 RATE_LIMITED → auto-retry (same key)
```

```
Student Account Pages
  /profile → GET /users/profile/:id → edit → PUT /users/profile
  /orders → GET /orders
  /notifications → GET /notifications (polled) → mark read → PATCH /notifications/:id/read
```

```
Club Admin / Super Admin Pages (each resolves "which club" via useClubContext;
Super Admin picks one from GET /clubs, Club Admin's is implicit from the JWT)
  /admin/create-item → POST /catalog
  /admin/delivery-slots → GET /catalog?clubId= → set slot → PUT /catalog/:id/delivery-slot
  /admin/orders → GET /orders/club + GET /catalog?clubId= (for item names) → Mark Delivered → PATCH /orders/:orderId/status
  (Super Admin only) /admin/promote → GET /users/lookup?email=, then PUT /users/:userId/role
  (Super Admin only) /admin/create-club → POST /clubs
```

---

## 4. Backend Issues Discovered That Shape the Frontend (not fixed here — noted so the frontend design accounts for them)

1. ~~**No "list/search users" endpoint exists.**~~ — **partially addressed 2026-09-11.** There's still no full user directory/search (and none is planned — see §15), but a minimal exact-match `GET /users/lookup?email=` (`SUPER_ADMIN` only) now exists specifically to back the promotion form: Super Admin types an email, gets back `{id, email, full_name, role, club_id}`, then promotes using the returned `id`. The Admin page's promotion form (Step 32) now uses this instead of a raw UUID input.
2. ~~**No club-creation endpoint exists.**~~ — **fixed 2026-09-11.** `POST /clubs` (`SUPER_ADMIN` only) now creates a club and assigns an admin (by email) in one transaction, promoting that user to `CLUB_ADMIN` if they were a `STUDENT`. The finalized requirements spec (`REQUIREMENTS.md` FR5.3) made this official Super Admin functionality, not optional — the Admin page's club selector (Step 28) stays a simple dropdown from `GET /clubs` for choosing which club to act as, and a separate "Create Club" form is Step 33.
3. ~~**The rate limiter's Valkey key was `rate_limit:${req.ip}` for *both* the catalog limiter and the orders limiter**~~ — **fixed 2026-09-11.** They were sharing one bucket per IP because the key didn't encode which limiter was running; `createRateLimiter` now takes a `name` and keys off `rate_limit:${name}:${req.ip}`, so catalog and orders each get their own bucket. The configured limit is still **1000 requests/min** per bucket in the current code (not the 100/5 documented in `SECURITY_AND_ACCESS.md`), so this is very unlikely to surface during manual testing either way. Also note: since rate limiting is per-IP, testing multiple seeded accounts from one machine still shares one bucket per route.
4. **No circuit breaker, health-aggregation, or queue-depth endpoint exists anywhere** — see §1. The "Super Admin Diagnostics Panel" from the old spec is dropped from scope entirely (§12).

The following were previously flagged here as gaps but are confirmed intentional, current behavior — not tracked as issues: checkout has no `STUDENT`-only role check (any authenticated role can place an order), internal-only catalog/order endpoints are technically reachable through the public gateway, registration doesn't accept a preferred size, JWTs are not refreshed (1-hour flat expiry), and a failed mock payment never creates an order row. The frontend is built to work correctly with all of this as-is.

None of these block building the frontend — they just determine exactly how a few flows must be shaped.

---

## 5. Page / Component Structure

**Revision note (2026-09-13):** originally planned as six routes with a single combined `/dashboard` page. After building it, Profile/Orders/Notifications were split into three separate flat routes (see the Phase 7 revision note above) — no shared state existed between them anyway, and this app never uses nested routes, so three flat pages was simpler than reaching for a new routing pattern just to keep them under one URL.

**Revision note (2026-09-14):** the same thing happened to `/admin` — see the Phase 8 revision note. It's five routes now (`/admin/create-item`, `/admin/delivery-slots`, `/admin/orders`, `/admin/promote`, `/admin/create-club`), and unlike the Dashboard split, three of them share real logic, pulled into a `useClubContext` hook + `ClubPicker` component rather than duplicated. That makes it twelve routes total now.

Twelve routes, backed by ~19 files total. No `Button.jsx`/`Card.jsx`/`Input.jsx`-style micro-components — plain HTML elements with the shared `index.css` classes are enough at this scale.

| Route | Page component | Purpose | Calls | Guarded? |
|---|---|---|---|---|
| `/login` | `LoginPage` | Email/password form → JWT | `POST /users/login` | Public |
| `/register` | `RegisterPage` | Email/password/name form | `POST /users/register` | Public |
| `/catalog` | `CatalogPage` | List + filter + paginate items | `GET /catalog` | Any logged-in user |
| `/catalog/:id` | `ItemDetailPage` | Item detail + checkout | `GET /catalog/:id`, `GET /users/profile/:id`, `POST /orders` | Any logged-in user |
| `/profile` | `ProfilePage` | View + edit saved profile/size | `GET/PUT /users/profile/:id` | Any logged-in user |
| `/orders` | `OrdersPage` | Order history | `GET /orders` | Any logged-in user |
| `/notifications` | `NotificationsPage` | Notification inbox, polled | `GET/PATCH /notifications` | Any logged-in user |
| `/admin/create-item` | `CreateItemPage` | Publish merchandise | `GET /clubs`, `POST /catalog` | `CLUB_ADMIN` / `SUPER_ADMIN` |
| `/admin/delivery-slots` | `DeliverySlotsPage` | Set delivery slots on the club's items | `GET /clubs`, `GET /catalog?clubId=`, `PUT /catalog/:id/delivery-slot` | `CLUB_ADMIN` / `SUPER_ADMIN` |
| `/admin/orders` | `ClubOrdersPage` | View + fulfill the club's orders | `GET /clubs`, `GET /orders/club`, `GET /catalog?clubId=`, `PATCH /orders/:id/status` | `CLUB_ADMIN` / `SUPER_ADMIN` |
| `/admin/promote` | `PromoteUserPage` | Look up a user by email, change their role | `GET /clubs`, `GET /users/lookup`, `PUT /users/:id/role` | `SUPER_ADMIN` only |
| `/admin/create-club` | `CreateClubPage` | Create a club + assign its admin | `POST /clubs` | `SUPER_ADMIN` only |

Supporting (non-page) files:

| File | Purpose | Why it exists |
|---|---|---|
| `App.jsx` | `<Routes>` definitions + renders `Navbar` | Root layout |
| `Navbar.jsx` | Top nav: Catalog / Profile / Orders / Notifications / (role-conditional admin links) / Logout | Shared across every page |
| `ProtectedRoute.jsx` | Redirects to `/login` if no token; optionally checks allowed roles | One small reusable guard, used 10 times (every route except login/register) — a genuine case for a shared component |
| `AuthContext.jsx` | Holds `{token, user}`, `login()`, `logout()`, persists to `localStorage`, decodes the JWT | The one piece of state every page/component needs — see §6 |
| `useClubContext.js` | Hook: resolves "which club am I acting as" for admin pages | Used identically by 3 admin pages — see the Phase 8 revision note |
| `ClubPicker.jsx` | Renders `useClubContext`'s result as a dropdown (Super Admin) or read-only text (Club Admin) | Same 3 admin pages |
| `api.js` | One `apiFetch()` helper function | See §7 |
| `main.jsx` | Renders `<BrowserRouter><AuthProvider><App/></AuthProvider></BrowserRouter>` | Entry point |
| `index.css` | Plain CSS: resets, form/button/table styling | No CSS framework |

That's it — no `hooks/`, `services/`, or `components/` folders; the two shared admin files just sit flat under `src/` next to everything else. `src/pages/` holds the twelve page files.

---

## 6. State Management

| State | Where it lives | Why |
|---|---|---|
| JWT + decoded user (`{sub, email, role, clubId}`) | `AuthContext` (React Context) + `localStorage` | Needed by `Navbar`, `ProtectedRoute`, and every page that calls a protected API — this is the textbook case where Context earns its keep. Local state or prop-drilling would mean threading the token through every route. |
| Catalog list, filters, pagination cursor, loading/error | Local `useState` in `CatalogPage` | Nobody else needs it. |
| Selected item, size choice, checkout status | Local `useState` in `ItemDetailPage` | Scoped to one page, thrown away on navigation. |
| Profile form fields | Local `useState` in `ProfilePage` | Scoped to that page only. |
| Orders list | Local `useState` in `OrdersPage` | Scoped to that page only. |
| Notifications list | Local `useState` in `NotificationsPage` | Scoped to that page only. |
| Acting club (`clubs`, `selectedClubId`) | `useClubContext` hook, called from `CreateItemPage`, `DeliverySlotsPage`, `ClubOrdersPage` | Genuinely shared logic across three pages — the one case among the admin pages worth lifting into a hook rather than duplicating. |
| Create-item form | Local `useState` in `CreateItemPage` | Scoped to that page only. |
| Delivery-slot inputs per item | Local `useState` in `DeliverySlotsPage` | Scoped to that page only. |
| Club's orders, club's items (for name lookup) | Local `useState` in `ClubOrdersPage` | Scoped to that page only. |
| User-lookup/promotion form | Local `useState` in `PromoteUserPage` | Scoped to that page only. |
| Create-club form | Local `useState` in `CreateClubPage` | Scoped to that page only. |

No Redux, no Zustand, no `useReducer` (the checkout flow uses a handful of plain `useState` flags and a `while` loop — see §12 Steps 22–23 — which is easier to read than a reducer for someone new to this).

**JWT decoding:** no `jwt-decode` package needed — a JWT payload is just base64url JSON. A 3-line helper does it:

```js
function decodeJwt(token) {
  const payload = token.split('.')[1];
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
}
```

This is not signature verification (the browser can't verify a signature it doesn't hold the secret for, and doesn't need to — the gateway already did that). It's purely for reading `sub`/`role`/`clubId`/`exp` to drive the UI.

---

## 7. Authentication Flow

```
Login form submit
      ↓
POST /users/login  →  { token, user }
      ↓
AuthContext.login(token):
   - decode token → { sub, email, role, clubId, exp }
   - localStorage.setItem('ccmms_token', token)
   - setState({ token, user: decoded })
      ↓
Every subsequent apiFetch() call reads context's token and adds:
   Authorization: Bearer <token>
      ↓
On app load (main.jsx / AuthProvider mount):
   - read token from localStorage
   - decode it; if exp has already passed, discard it (treat as logged out)
   - otherwise populate context so a page refresh doesn't log the user out
      ↓
Any API call that comes back 401:
   - the page's error handler calls AuthContext.logout() and redirects to /login
      ↓
Logout button (Navbar):
   - localStorage.removeItem('ccmms_token')
   - setState({ token: null, user: null })
   - navigate('/login')
```

- **Where the token lives:** `localStorage`, key `ccmms_token`. Simplest option; the standard tradeoff (vulnerable to XSS if the app ever includes untrusted third-party scripts) is acceptable for a local learning/demo project with no such scripts.
- **How it's attached:** one `if (token) headers.Authorization = 'Bearer ' + token` line inside `apiFetch()` — not an Axios interceptor.
- **Protected routes:** `ProtectedRoute` reads `AuthContext`; if there's no token, `<Navigate to="/login" />`. An optional `roles` prop lets the three shared admin routes (`/admin/create-item`, `/admin/delivery-slots`, `/admin/orders`) require `CLUB_ADMIN`/`SUPER_ADMIN`, and the two Super-Admin-only ones (`/admin/promote`, `/admin/create-club`) require `SUPER_ADMIN` specifically — bouncing anyone else to `/catalog`.
- **Missing token on a protected page:** never actually reachable mid-render, because `ProtectedRoute` redirects before the page mounts — but `apiFetch` still defends itself (skips adding the header rather than sending `Authorization: Bearer undefined`).
- **Backend auth error (`401`):** every page's `catch` block checks `err.status === 401` and calls `logout()` + redirects, so an expired token always lands the user back on `/login` with a plain "Session expired, please log in again" message instead of a broken page.

---

## 8. API Integration Strategy

**Base URL:** `import.meta.env.VITE_API_BASE_URL`, defaulting to `http://localhost:3000/api/v1` in `frontend/.env` (gitignored, like every other `.env` in this repo) with `frontend/.env.example` committed for reference.

**Client:** plain `fetch`, wrapped in one helper (`src/api.js`):

```js
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';

export async function apiFetch(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = res.status;
    error.body = data;
    error.retryAfter = res.headers.get('Retry-After');
    throw error;
  }

  return data;
}
```

Every page follows the same three-state pattern: `loading` (boolean), `error` (string or null), `data`. A `try/catch` around `apiFetch` sets one or the other. This is the entire "API layer" — no axios, no interceptors, no query-caching library. `GET`/`POST`/`PUT`/`PATCH` are all just different `method` values passed to the same function.

**Checkout is the one place that needs more than this** because it must react to specific status codes and a `Retry-After` header — see the full contract table:

| Response | Frontend action |
|---|---|
| `201` (or `200` idempotent replay) | `SUCCESS` — show order, link to `/orders` |
| `409 LOCK_CONTENTION_DETECTED` (has `Retry-After`) | wait `Retry-After` seconds + a little jitter, retry with the **same** Idempotency-Key, up to 3 attempts total |
| `429 RATE_LIMITED` (has `Retry-After`) | same as above |
| `409` "already being processed" | treat as `FAILED` — this means a duplicate request raced itself; tell the user to check `/orders` for the order rather than blindly retrying |
| `400 OUT_OF_STOCK` / `409 OUT_OF_STOCK` | `OUT_OF_STOCK` — stop, no retry |
| `400 PAYMENT_FAILED` | `FAILED` — stop, no retry, explain the mock-card rule |
| `400 PREFERRED_SIZE_UNAVAILABLE` / `NO_PREFERRED_SIZE` / `SELECTED_SIZE_UNAVAILABLE` | show the size picker with `availableSizes` from the response body; when the user picks a size and resubmits, treat it as a **brand-new** checkout attempt (new Idempotency-Key) — nothing was ever reserved on this path, so there's nothing to "retry" |
| Anything else (4xx/5xx) | `FAILED` — show `err.body.error` or a generic message |

Retry loop is a plain `while` with a counter — no state-machine library:

```js
let attempts = 0;
while (attempts < 3) {
  try {
    const data = await apiFetch('/orders', { method: 'POST', token, body, headers: { 'Idempotency-Key': key } });
    setStatus('SUCCESS'); setOrder(data.order); return;
  } catch (err) {
    if (err.body?.error === 'LOCK_CONTENTION_DETECTED' || err.body?.error === 'RATE_LIMITED') {
      attempts++;
      const waitMs = (Number(err.retryAfter) || 1) * 1000 + Math.random() * 300;
      setStatus('RETRYING');
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    // classify and stop — see table above
    handleTerminalError(err);
    return;
  }
}
setStatus('FAILED'); // exhausted retries
```

---

## 9. Error / Loading / Empty States

Every page that fetches data shows exactly one of these four things — plain text, no toasts, no animated spinners:

```
Loading...
Failed to load <thing>.
No <thing> found.
<Success confirmation text, where relevant>
```

Concretely:
- Catalog empty → "No merchandise available yet."
- Orders empty → "You haven't placed any orders yet."
- Notifications empty → "No notifications yet."
- Any fetch failure → "Failed to load <thing>. <err.message>"
- Checkout success → "Order placed successfully! View it in your orders."
- Checkout retrying → "Retrying... (attempt 2 of 3)"

No sophisticated UX (no toast library, no retry countdown UI beyond a plain text line) — this is explicitly out of scope per the project's own priorities.

---

## 10. UI Design

White background, black text, system font, one shared `index.css`:
- `<table>` for lists (catalog, orders, notifications, club orders) — plain borders, no zebra striping needed.
- `<form>` + `<label>` + `<input>`/`<select>` for every form, laid out in a simple vertical stack.
- One `.btn` class for buttons (default browser button styling is fine; a couple of lines of padding/border is enough).
- No modal library — the item detail "checkout" is its own page (`/catalog/:id`), not a modal, which is simpler to build and test.
- No icons, no images beyond whatever the catalog item data itself doesn't even provide (there's no image field in the `Item` schema — text-only cards are correct, not a placeholder gap).
- Basic responsiveness: a single centered column with `max-width`, no breakpoints needed.

---

## 12. Implementation Order

### Phase 1 — Project Setup

#### Step 1 — Create the Vite React project
**Goal:** Get an empty React app running.
**Files involved:** New `frontend/` directory (created by the Vite scaffold): `frontend/package.json`, `frontend/vite.config.js`, `frontend/index.html`, `frontend/src/main.jsx`, `frontend/src/App.jsx`.
**Concepts I will learn:** what Vite is, npm project structure, JSX entry points.
**Implementation:** Run `npm create vite@latest frontend -- --template react` from the repo root. Do not add it to the root `package.json` workspaces array — keep it a fully separate project so it can't accidentally disturb the backend's `npm run dev`.
**Backend interaction:** None.
**Expected behavior:** `cd frontend && npm install && npm run dev` opens the default Vite+React starter page.
**How to verify:** Visit the printed localhost URL (usually `http://localhost:5173`) and see the default page.
**Why are we doing it this way?** Vite's official scaffold is the zero-config standard; no reason to hand-roll a bundler config.

#### Step 2 — Configure environment variables
**Goal:** Make the API base URL configurable instead of hardcoded.
**Files involved:** `frontend/.env` (new, gitignored by the existing root `.gitignore` pattern), `frontend/.env.example` (new, committed).
**Concepts I will learn:** Vite's `import.meta.env.VITE_*` convention.
**Implementation:** `frontend/.env` gets `VITE_API_BASE_URL=http://localhost:3000/api/v1`. `frontend/.env.example` gets the same line as a template for anyone else cloning the repo.
**Backend interaction:** None yet — this is just wiring for later steps.
**Expected behavior:** `import.meta.env.VITE_API_BASE_URL` is readable inside any component.
**How to verify:** Temporarily `console.log(import.meta.env.VITE_API_BASE_URL)` in `App.jsx` and check the browser console.
**Why are we doing it this way?** So the gateway URL isn't baked into the code — matches how the backend already externalizes config via the root `.env`.

#### Step 3 — Strip the Vite boilerplate and add plain CSS
**Goal:** Clean slate before building real pages.
**Files involved:** `frontend/src/App.jsx`, `frontend/src/index.css`, delete `frontend/src/App.css` and the default logo assets.
**Concepts I will learn:** basic CSS reset, importing a stylesheet in `main.jsx`.
**Implementation:** Replace `App.jsx` with a single `<h1>CCMMS</h1>` placeholder. Write a small `index.css`: `box-sizing: border-box`, a max-width centered `body`, base styles for `table`, `input`, `select`, `button`, `.btn`, `.error-text`.
**Backend interaction:** None.
**Expected behavior:** Blank white page with plain heading and no leftover Vite branding.
**How to verify:** Reload the dev server, confirm the page is plain.
**Why are we doing it this way?** Confirms the "minimal look" decision from day one instead of fighting default styling later.

### Phase 2 — Routing Skeleton

#### Step 4 — Install and configure React Router
**Goal:** Enable multi-page navigation.
**Files involved:** `frontend/package.json` (adds `react-router-dom`), `frontend/src/main.jsx`.
**Concepts I will learn:** `<BrowserRouter>`, why routing needs to wrap the whole app.
**Implementation:** `npm install react-router-dom` inside `frontend/`. Wrap `<App />` in `<BrowserRouter>` inside `main.jsx`.
**Backend interaction:** None.
**Expected behavior:** No visible change yet, but routing primitives are now available.
**How to verify:** App still renders with no console errors.
**Why are we doing it this way?** React Router is the standard, simplest routing library for React SPAs — no reason to hand-roll route matching.

#### Step 5 — Create placeholder pages for all six routes
**Goal:** Have a real file for every planned page before filling in logic.
**Files involved:** new `frontend/src/pages/LoginPage.jsx`, `RegisterPage.jsx`, `CatalogPage.jsx`, `ItemDetailPage.jsx`, `DashboardPage.jsx`, `AdminPage.jsx` — each just returns `<h2>Page Name</h2>` for now.
**Concepts I will learn:** function components, default exports.
**Implementation:** One file per page, minimal content.
**Backend interaction:** None.
**Expected behavior:** Files exist and export a component each.
**How to verify:** No build errors when imported.
**Why are we doing it this way?** Keeps the "wire up routing" step separate from "build the page," so each step stays small.

#### Step 6 — Wire up `<Routes>` in `App.jsx`
**Goal:** Make all six URLs reachable.
**Files involved:** `frontend/src/App.jsx`.
**Concepts I will learn:** `<Routes>`, `<Route path/element>`, `<Link>`.
**Implementation:** Import all six page placeholders; render `<Routes>` with one `<Route>` per path, plus a `<Route path="/" element={<Navigate to="/catalog" />} />`.
**Backend interaction:** None.
**Expected behavior:** Navigating to `/login`, `/register`, `/catalog`, `/catalog/123`, `/dashboard`, `/admin` in the URL bar shows the right placeholder.
**How to verify:** Manually type each URL in the browser and confirm the right heading appears.
**Why are we doing it this way?** Verifying routing before adding auth/data logic isolates failures to one layer at a time.

### Phase 3 — API Layer & Auth Foundation

#### Step 7 — Build the `apiFetch` helper
**Goal:** One place that knows how to call the gateway.
**Files involved:** new `frontend/src/api.js`.
**Concepts I will learn:** `fetch`, `async/await`, throwing custom `Error` objects with extra fields, reading response headers.
**Implementation:** Exactly the `apiFetch()` function shown in §8 — reads `VITE_API_BASE_URL`, JSON-encodes the body, attaches `Authorization` if a token is passed, throws an `Error` carrying `.status`/`.body`/`.retryAfter` on a non-`ok` response.
**Backend interaction:** None directly (no calls made yet), but this is the function every later step uses to talk to `/api/v1/*`.
**Expected behavior:** Function is exported and callable.
**How to verify:** Temporarily call `apiFetch('/clubs')` from `App.jsx`'s `useEffect` (with the backend running) and `console.log` the result — even without a token, this route requires auth, so expect a thrown error with `status: 401`, proving the error path works too.
**Why are we doing it this way?** A single small function is enough — no need for an Axios instance, base config object, or interceptor chain to get the exact same behavior.

#### Step 8 — Build `AuthContext`
**Goal:** One shared place for "who's logged in."
**Files involved:** new `frontend/src/AuthContext.jsx`.
**Concepts I will learn:** `createContext`, `useContext`, `useState`, `useEffect` (for the localStorage-hydrate-on-mount step), custom hooks (`useAuth`).
**Implementation:** `AuthContext = createContext(null)`. `AuthProvider` component holds `token`/`user` state, exposes `login(token)` (decodes + stores + sets state), `logout()` (clears storage + state). On mount, `useEffect` reads `localStorage.getItem('ccmms_token')`, decodes it, checks `exp` against `Date.now()/1000`, and populates state if still valid (else clears it). Export `useAuth = () => useContext(AuthContext)`. Include the `decodeJwt` helper from §6 in this same file (it's only used here).
**Backend interaction:** None directly — this just manages the JWT the login step will produce.
**Expected behavior:** Any component can call `const { token, user, login, logout } = useAuth()`.
**How to verify:** Temporarily render `{JSON.stringify(useAuth())}` somewhere and confirm it starts as `{token: null, user: null}`.
**Why are we doing it this way?** This is the one piece of truly cross-cutting state in the whole app — the textbook justification for Context instead of prop drilling.

#### Step 9 — Wrap the app in `AuthProvider`
**Goal:** Make `useAuth()` usable anywhere.
**Files involved:** `frontend/src/main.jsx`.
**Concepts I will learn:** provider nesting order.
**Implementation:** `<BrowserRouter><AuthProvider><App/></AuthProvider></BrowserRouter>`.
**Backend interaction:** None.
**Expected behavior:** No visible change; context is now available app-wide.
**How to verify:** The Step 8 verification (rendering `useAuth()`'s value) still works from inside any page.
**Why are we doing it this way?** Context must wrap everything that needs it; the app root is the natural place.

#### Step 10 — Build `ProtectedRoute`
**Goal:** Redirect logged-out users away from pages that need auth.
**Files involved:** new `frontend/src/ProtectedRoute.jsx`.
**Concepts I will learn:** `<Navigate>`, conditional rendering, passing `children` as a prop.
**Implementation:** `ProtectedRoute({ children, roles })` — if `!token`, `<Navigate to="/login" />`; if `roles` is given and `!roles.includes(user.role)`, `<Navigate to="/catalog" />`; else render `children`.
**Backend interaction:** None.
**Expected behavior:** Not yet wired into routes (next step).
**How to verify:** N/A yet.
**Why are we doing it this way?** One small reusable guard used four times is exactly the kind of shared component worth having, unlike splitting every `<div>` into its own file.

#### Step 11 — Wrap the four protected routes
**Goal:** Actually enforce the guard.
**Files involved:** `frontend/src/App.jsx`.
**Concepts I will learn:** composing components as route `element`s.
**Implementation:** Wrap `/catalog`, `/catalog/:id`, `/dashboard` in `<ProtectedRoute>`; wrap `/admin` in `<ProtectedRoute roles={['CLUB_ADMIN', 'SUPER_ADMIN']}>`.
**Backend interaction:** None.
**Expected behavior:** Visiting `/catalog` with no token redirects to `/login`.
**How to verify:** Clear `localStorage`, visit `http://localhost:5173/catalog` directly — confirm redirect.
**Why are we doing it this way?** Confirms the auth wall works before any real page content exists behind it.

#### Step 12 — Build `Navbar`
**Goal:** One place to navigate and log out.
**Files involved:** new `frontend/src/Navbar.jsx`, edit `App.jsx` to render it above `<Routes>`.
**Concepts I will learn:** conditional rendering based on context, `useNavigate`.
**Implementation:** Show `Catalog`/`Profile`/`Orders`/`Notifications` links if `token` exists; show `Admin` link only if `role` is `CLUB_ADMIN`/`SUPER_ADMIN`; show `Login`/`Register` links if no `token`; show a `Logout` button (calls `logout()` then `navigate('/login')`) if `token` exists.
**Backend interaction:** None.
**Expected behavior:** Nav changes based on login state.
**How to verify:** Toggle by manually calling `login()`/`logout()` from the console once Step 16 exists, or just eyeball the logged-out state now.
**Why are we doing it this way?** Simple conditional JSX is enough; no need for a routing-aware nav library.

### Phase 4 — Registration & Login

#### Step 13 — Build the register form
**Goal:** Let a new student create an account.
**Files involved:** `frontend/src/pages/RegisterPage.jsx`.
**Concepts I will learn:** controlled inputs (`value`+`onChange`), form `onSubmit`, `preventDefault`.
**Implementation:** Three inputs (email, password, full name) in local `useState`. On submit, call `apiFetch('/users/register', { method: 'POST', body: {...} })`. Optional (not required, purely a nicer UX touch): a client-side regex check against `^[a-zA-Z0-9._%+-]+@students\.iiit\.ac\.in$` that shows an inline warning before submit — the backend's `403` remains the real authority.
**Backend interaction:** `POST /users/register`.
**Expected behavior:** Success → show "Registered! Please log in." and a link to `/login`. Failure → show `err.body.error` (e.g. "Registration is restricted only to iiit students").
**How to verify:** Register with a `@gmail.com` email → see the domain error. Register with a valid `@students.iiit.ac.in` email → success message.
**Why are we doing it this way?** A plain controlled form is the simplest correct way to collect three fields; no form library needed for three inputs.

#### Step 14 — Build the login form
**Goal:** Let an existing user log in.
**Files involved:** `frontend/src/pages/LoginPage.jsx`.
**Concepts I will learn:** same controlled-form pattern, calling context functions from a page.
**Implementation:** Email + password inputs. On submit, `apiFetch('/users/login', {...})`, then `auth.login(data.token)`, then `navigate('/catalog')`.
**Backend interaction:** `POST /users/login`.
**Expected behavior:** Correct credentials → redirected to `/catalog`, Navbar updates. Wrong credentials → "invalid credentials" shown inline.
**How to verify:** Use one of the seeded demo accounts documented in the root `.env` comments (a Student, a Club Admin, and the Super Admin all already exist) — log in as each and confirm `Navbar` shows the right links per role.
**Why are we doing it this way?** Reuses the exact same pattern as registration — no new concepts needed.

#### Step 15 — Verify the full auth loop
**Goal:** Confirm persistence and logout work end-to-end.
**Files involved:** none (verification-only step).
**Concepts I will learn:** how `localStorage` persists across a hard refresh.
**Implementation:** No code change.
**Backend interaction:** None new.
**Expected behavior:** Log in → refresh the page → still logged in (context rehydrates from `localStorage`). Click Logout → redirected to `/login`, refreshing no longer shows protected content.
**How to verify:** Manually perform the sequence above in the browser.
**Why are we doing it this way?** This is the point where auth is fully working before any real data is layered on top — worth confirming in isolation.

### Phase 5 — Catalog Browsing

#### Step 16 — Fetch and list catalog items
**Goal:** Show real merchandise data.
**Files involved:** `frontend/src/pages/CatalogPage.jsx`.
**Concepts I will learn:** `useEffect` for data fetching on mount, `.map()` over an array with a `key` prop, loading/error/empty state pattern.
**Implementation:** On mount, `apiFetch('/catalog', { token })`. Render `items` as a `<table>` (name, type, club, price, stock), each row linking to `/catalog/:id` via `<Link>`.
**Backend interaction:** `GET /catalog`.
**Expected behavior:** Table of items appears; empty catalog shows "No merchandise available yet."
**How to verify:** With the backend running and at least one item created (via Step 29 later, or manually), confirm the table renders; temporarily stop the catalog-service process to see the error state.
**Why are we doing it this way?** The simplest data-fetch-and-render pattern in React; no query library needed for a one-shot fetch.

#### Step 17 — Add type/club filters
**Goal:** Demonstrate the backend's query-param filtering.
**Files involved:** `frontend/src/pages/CatalogPage.jsx`.
**Concepts I will learn:** re-running an effect when a dependency changes (`useEffect` dependency array).
**Implementation:** Two `<select>`s (type: APPAREL/MUG/ACCESSORY/All; club: populated from `GET /clubs`). Changing either re-fetches `GET /catalog?type=&clubId=` and resets pagination.
**Backend interaction:** `GET /catalog?type=&clubId=`, `GET /clubs`.
**Expected behavior:** Selecting a filter narrows the list.
**How to verify:** Create items for two different clubs/types (Step 29) and confirm filtering narrows correctly.
**Why are we doing it this way?** Query params map directly onto two `<select>` elements — no need for a filter-state abstraction.

#### Step 18 — Add cursor pagination
**Goal:** Demonstrate the backend's cursor-based "Load More."
**Files involved:** `frontend/src/pages/CatalogPage.jsx`.
**Concepts I will learn:** appending to an array in state, conditional button rendering.
**Implementation:** Track `nextCursor` from the response. "Load More" button (hidden when `nextCursor` is `null`) calls `GET /catalog?cursor=...` and appends results to the existing list.
**Backend interaction:** `GET /catalog?cursor=`.
**Expected behavior:** With more than 10 items, "Load More" reveals the next page.
**How to verify:** Create 11+ items via the admin page and confirm pagination works.
**Why are we doing it this way?** Matches exactly what the backend already implements — no offset-based pagination needed.

### Phase 6 — Item Detail & Checkout

#### Step 19 — Fetch and display item detail
**Goal:** Show one item's full data.
**Files involved:** `frontend/src/pages/ItemDetailPage.jsx`.
**Concepts I will learn:** `useParams` to read the `:id` from the URL.
**Implementation:** On mount, `apiFetch('/catalog/' + id, { token })`. Render name/description/price/stock/availableSizes/deliverySlot.
**Backend interaction:** `GET /catalog/:id`.
**Expected behavior:** Clicking an item from the catalog shows its detail page.
**How to verify:** Click through from `/catalog`.
**Why are we doing it this way?** Same fetch-on-mount pattern as Step 16.

#### Step 20 — Resolve the preferred size against availability
**Goal:** Demonstrate automated size injection and the out-of-stock fallback.
**Files involved:** `frontend/src/pages/ItemDetailPage.jsx`.
**Concepts I will learn:** deriving UI state from two pieces of fetched data, conditional rendering.
**Implementation:** Also fetch `GET /users/profile/:id` (using `user.sub` from `useAuth()`) to get `preferred_size`. If `item.availableSizes` is empty, skip size selection entirely (mugs/some accessories). Else, if `preferred_size` is in `availableSizes`, pre-select it as a radio button; otherwise show a yellow-ish inline warning ("Your saved size is unavailable for this item — please choose one below") and force a manual radio selection from `availableSizes` with none pre-checked.
**Backend interaction:** `GET /users/profile/:userId`.
**Expected behavior:** Matches Journey 3 from the PRD exactly.
**How to verify:** Set your profile's preferred size to one not in a given item's `availableSizes` (via Step 24) and confirm the warning + forced manual pick.
**Why are we doing it this way?** This client-side check is a nice-to-have UX layer on top of a checkout call that will defensively re-check the same thing server-side anyway (Step 22) — cheap to add since the data is already being fetched.

#### Step 21 — Build the checkout form
**Goal:** Collect quantity + mock payment input.
**Files involved:** `frontend/src/pages/ItemDetailPage.jsx`.
**Concepts I will learn:** number inputs, `crypto.randomUUID()`.
**Implementation:** A quantity `<input type="number" min="1">` (default 1), a mock card `<input>` with a visible hint ("Enter 4242 for success, anything else fails"), and a "Place Order" `<button>`. No submission logic yet — just the form and local state.
**Backend interaction:** None yet.
**Expected behavior:** Form renders and updates local state.
**How to verify:** Type into the fields, confirm state updates (temporary `console.log`).
**Why are we doing it this way?** Separating "build the form" from "wire up the submit logic" (next step) keeps this step small, per the checkout flow being the one area worth extra care.

#### Step 22 — Wire up the checkout submit handler (happy path + terminal errors)
**Goal:** Actually place an order.
**Files involved:** `frontend/src/pages/ItemDetailPage.jsx`.
**Concepts I will learn:** generating a UUID once per user action (not per request), disabling a button during an async operation, mapping backend error codes to messages.
**Implementation:** On submit: generate `const key = crypto.randomUUID()` **once**, set `status = 'PLACING_ORDER'` and disable the button, call `POST /orders` with `Idempotency-Key: key` and the form body. Handle the terminal cases from the §8 table (`SUCCESS`, `OUT_OF_STOCK`, `PAYMENT_FAILED`, the three size-related 400s). Do **not** yet handle the two retryable cases (409 lock / 429 rate-limit) — that's the next step, kept separate because it's the trickiest part.
**Backend interaction:** `POST /orders`.
**Expected behavior:** `mockCardNumber=4242` → success message + link to `/orders`. Any other value → "Payment failed (mock value 4000 detected)." Zero stock → "Out of stock."
**How to verify:** Manually test each mock card value and an item with `stock: 0`.
**Why are we doing it this way?** Splitting "happy path + simple errors" from "retry logic" keeps each step reviewable on its own, in line with "small enough to understand before moving on."

#### Step 23 — Add retry handling for lock contention and rate limiting
**Goal:** Demonstrate the distributed lock and rate limiter gracefully instead of just failing.
**Files involved:** `frontend/src/pages/ItemDetailPage.jsx`.
**Concepts I will learn:** reading a response header (`Retry-After`), `setTimeout` wrapped in a `Promise` for a delay, a bounded retry loop, basic jitter.
**Implementation:** Exactly the `while (attempts < 3)` loop from §8, reusing the **same** `key` variable across every attempt. Show `status = 'RETRYING'` with attempt count while waiting.
**Backend interaction:** Same `POST /orders` endpoint, called up to 3 times per click.
**Expected behavior:** Under normal conditions this is rarely visible (locks release in milliseconds), but is provably correct — see verification.
**How to verify:** Open two browser tabs logged in as two different seeded students, both on the same item's page. Click "Place Order" in both within the same second. One should succeed immediately; the other should briefly show "Retrying..." and then either succeed (if stock remains) or show "Out of stock."
**Why are we doing it this way?** This is the single most valuable thing this frontend can demonstrate about the backend — worth the extra ~15 lines of `while`-loop code, still written as plain control flow rather than a formal state machine class.

### Phase 7 — Student Account Pages (Profile, Orders, Notifications)

**Revision note (2026-09-13):** this phase originally built one `/dashboard` page with three `<section>`s in a single `DashboardPage.jsx` file. After building it, the user asked for genuine separation of concerns — three separate pages/routes instead. Since the three sections never shared state anyway, and every other route in this app is already flat (no nesting), the fix was straightforward: three standalone pages (`ProfilePage.jsx`, `OrdersPage.jsx`, `NotificationsPage.jsx`) at `/profile`, `/orders`, `/notifications`, each wrapped in `<ProtectedRoute>` same as before, with matching Navbar links replacing the single "Dashboard" link. `/dashboard` no longer exists. The steps below reflect the current (post-revision) structure.

#### Step 24 — Build the Profile page
**Goal:** Let a student see and update their saved details.
**Files involved:** new `frontend/src/pages/ProfilePage.jsx`; `App.jsx` (add the `/profile` route); `Navbar.jsx` (add a Profile link).
**Concepts I will learn:** pre-filling a form from fetched data, partial updates.
**Implementation:** On mount, `GET /users/profile/:id` (using `user.sub`). Populate a form (full_name, phone, hostel_block, preferred_size dropdown: S/M/L/XL/XXL). On submit, `PUT /users/profile` with whichever fields are non-empty.
**Backend interaction:** `GET /users/profile/:userId`, `PUT /users/profile`.
**Expected behavior:** Changing preferred size and saving persists it (confirm by revisiting an item detail page — Step 20's logic now sees the new size).
**How to verify:** Change size to one an existing item doesn't offer, save, then revisit that item's detail page and confirm the out-of-stock-fallback warning now appears.
**Why are we doing it this way?** One combined form via `PUT /users/profile` covers every field including size — the dedicated `PUT /users/size` endpoint is redundant for this UI and intentionally not called (see §2 table note).

#### Step 25 — Build the Orders page
**Goal:** Show order history.
**Files involved:** new `frontend/src/pages/OrdersPage.jsx`; `App.jsx` (add the `/orders` route); `Navbar.jsx` (add an Orders link).
**Concepts I will learn:** rendering a table from an array, formatting a status value.
**Implementation:** On mount, `GET /orders`. Render a table: item id, size, quantity, status, date. (Item *names* aren't available from this endpoint — it only returns `catalog_item_id` — so each row shows a "View item" link to `/catalog/:catalog_item_id` instead of trying to resolve the name. Not worth an extra join/fetch per row for this minimal UI.)
**Backend interaction:** `GET /orders`.
**Expected behavior:** After placing an order (Phase 6), it appears here with status `COMMITTED`.
**How to verify:** Place an order, visit `/orders`, confirm it's listed.
**Why are we doing it this way?** Matches exactly what the backend returns; resisting the urge to enrich each row with a second API call per order keeps this step simple (and correct — the data really is just an id).

#### Step 26 — Build the Notifications page
**Goal:** Show and acknowledge notifications.
**Files involved:** new `frontend/src/pages/NotificationsPage.jsx`; `App.jsx` (add the `/notifications` route); `Navbar.jsx` (add a Notifications link).
**Concepts I will learn:** `PATCH` requests, updating one item in an array of state without refetching everything.
**Implementation:** On mount, `GET /notifications`. Render a list (message, type, timestamp, a "Mark read" button shown only if `!is_read`). Clicking it calls `PATCH /notifications/:id/read` and updates that one item's `is_read` in local state.
**Backend interaction:** `GET /notifications`, `PATCH /notifications/:id/read`.
**Expected behavior:** Unread notifications are visually distinguished (e.g. highlighted); clicking "Mark read" un-marks them without a full page reload.
**How to verify:** Place an order, wait a couple seconds, visit `/notifications`, confirm an `ORDER_PLACED` notification appears; mark it read.
**Why are we doing it this way?** Updating one array element in place (`setNotifications(list => list.map(n => n.id === id ? {...n, is_read:true} : n))`) avoids an unnecessary re-fetch.

#### Step 27 — Poll notifications while the page is open
**Goal:** Approximate "real-time" without a WebSocket the backend doesn't have.
**Files involved:** `frontend/src/pages/NotificationsPage.jsx`.
**Concepts I will learn:** `setInterval` inside `useEffect`, and — critically — the cleanup function that calls `clearInterval` on unmount.
**Implementation:** `useEffect(() => { const id = setInterval(fetchNotifications, 15000); return () => clearInterval(id); }, [token])`.
**Backend interaction:** Repeated `GET /notifications` every 15 seconds while the page is mounted.
**Expected behavior:** Trigger a delivery-slot update from `/admin` (Step 30) while `/notifications` is open in another tab and watch the notification appear within ~15 seconds without refreshing.
**How to verify:** As above.
**Why are we doing it this way?** This is the simplest possible stand-in for real-time updates, and — since no SSE/WebSocket endpoint exists in the backend at all — the *only* honest option. The cleanup function is the one non-obvious detail worth calling out explicitly (a forgotten `clearInterval` is a classic React bug).

### Phase 8 — Club Admin / Super Admin Pages

**Revision note (2026-09-14):** originally planned (and first built) as one `/admin` page with every section — create item, delivery slots, club orders, plus Super Admin's promotion/club-creation forms — all in a single `AdminPage.jsx`, following the "one page serves both roles" reasoning below. After building it, the user asked for the same separation of concerns as Phase 7: five separate pages instead. Unlike the Dashboard split, three of these pages (Create Item, Delivery Slots, Club Orders) *do* share real logic — each needs to resolve "which club am I acting as" the same way — so that piece was pulled into a shared `useClubContext` hook (`frontend/src/useClubContext.js`) and a `ClubPicker` presentational component (`frontend/src/ClubPicker.jsx`), used by all three pages instead of duplicated three times. The two Super-Admin-only pages (Promote, Create Club) don't need the acting-club concept at all, so they don't use it. Routes live under an `/admin/...` prefix (`/admin/create-item`, `/admin/delivery-slots`, `/admin/orders`, `/admin/promote`, `/admin/create-club`) purely to avoid name collisions with student-facing routes (`/orders` already exists) — these are still flat routes, not React Router nesting/`<Outlet>`. The steps below reflect this current structure.

Also fixed while building the Club Orders page: it was showing a raw `catalog_item_id` and not showing which student placed the order at all. See Step 31 below.

#### Step 28 — Build the `useClubContext` hook and `ClubPicker` component
**Goal:** Establish which club an admin page is acting for, in one reusable place instead of three copies.
**Files involved:** new `frontend/src/useClubContext.js`, `frontend/src/ClubPicker.jsx`.
**Concepts I will learn:** a custom hook that returns derived values (not just raw state), deriving a value differently based on role.
**Implementation:** `useClubContext(token, user)` fetches `GET /clubs` once and returns `{clubs, isSuperAdmin, selectedClubId, setSelectedClubId, resolvedClubId, resolvedClubName}` — `resolvedClubId` is `selectedClubId` for a Super Admin or `user.clubId` (from the JWT) for a Club Admin. `ClubPicker` renders a `<select>` for Super Admin or read-only "Managing: <name>" text for Club Admin, from whatever the hook returned.
**Backend interaction:** `GET /clubs`.
**Expected behavior:** Nothing visible yet — this step only builds the shared pieces the next three pages consume.
**How to verify:** No standalone UI to check yet; verified together with Step 29.
**Why are we doing it this way?** Three pages need this exact logic — a genuine case for a shared hook, unlike the Dashboard's three sections which shared nothing. Kept as a hook + a small presentational component rather than a Context, since nothing outside these three admin pages needs this value.

#### Step 29 — Build the Create Item page
**Goal:** Publish new merchandise.
**Files involved:** new `frontend/src/pages/CreateItemPage.jsx`; `App.jsx` (add `/admin/create-item`, role-restricted to `CLUB_ADMIN`/`SUPER_ADMIN`); `Navbar.jsx` (add a Create Item link, shown to both those roles).
**Concepts I will learn:** conditionally showing a form field based on another field's value (type → sizes).
**Implementation:** Uses `useClubContext` + `<ClubPicker>` at the top; if no club is resolved yet (Super Admin hasn't picked one), show a prompt instead of the form. Fields: name, description, price, stock, type (`<select>` APPAREL/MUG/ACCESSORY). If type is `APPAREL` (required) or `ACCESSORY` (optional), show a text input for comma-separated sizes (e.g. `S,M,L`) split into an array on submit. On submit: `POST /catalog` with `clubId` included only when `role === 'SUPER_ADMIN'`.
**Backend interaction:** `GET /clubs`, `POST /catalog`.
**Expected behavior:** New item appears on `/catalog` afterward.
**How to verify:** Create one APPAREL item and one MUG item; confirm the APPAREL one requires sizes (try submitting without any — expect the backend's `400`) and the MUG one doesn't.
**Why are we doing it this way?** No dynamic "Factory Pattern UI" with per-type extra fields (volume, material, etc.) — those are optional freeform fields the backend happily ignores if absent, so building a form for them adds complexity with no functional payoff for a demo.

#### Step 30 — Build the Delivery Slots page
**Goal:** Demonstrate the delivery-slot broadcast feature.
**Files involved:** new `frontend/src/pages/DeliverySlotsPage.jsx`; `App.jsx` (add `/admin/delivery-slots`); `Navbar.jsx` (add a Delivery Slots link).
**Concepts I will learn:** reusing the same `GET /catalog?clubId=` endpoint from the student-facing catalog for an admin-facing purpose.
**Implementation:** Uses `useClubContext` + `<ClubPicker>`. Fetch `GET /catalog?clubId=<resolved clubId>`, list items with a small inline form per row: date/startTime/endTime inputs + "Set Slot" button → `PUT /catalog/:itemId/delivery-slot`.
**Backend interaction:** `GET /clubs`, `GET /catalog?clubId=`, `PUT /catalog/:itemId/delivery-slot`.
**Expected behavior:** Setting a slot triggers a `delivery.slot.updated` event; any student who has ordered that item gets a notification (visible via Step 26/27).
**How to verify:** As a student, place an order for an item; as that item's Club Admin, set a delivery slot; back on the student's `/notifications` page, confirm the notification appears within ~15 seconds.
**Why are we doing it this way?** This is the clearest end-to-end demonstration of the RabbitMQ event flow (`catalog-service` → exchange → `notification-service` → Postgres) available anywhere in the app — worth calling out explicitly as a manual test, not just a code review.

#### Step 31 — Build the Club Orders page
**Goal:** Close the order lifecycle loop.
**Files involved:** new `frontend/src/pages/ClubOrdersPage.jsx`; `App.jsx` (add `/admin/orders`); `Navbar.jsx` (add a Club Orders link).
**Concepts I will learn:** nothing new — same table + button-triggers-PATCH pattern as notifications; fetching two endpoints in parallel with `Promise.all` to enrich one list from another.
**Implementation:** Uses `useClubContext` + `<ClubPicker>`. Fetches `GET /orders/club` (with `?clubId=` appended only for `SUPER_ADMIN`) **and** `GET /catalog?clubId=` in parallel, and looks each order's `catalog_item_id` up against the fetched item list to show a real item name instead of a raw Mongo id. Table: item name, student, size, qty, status, date, with a "Mark Delivered" button shown only when `status === 'COMMITTED'`. Clicking it calls `PATCH /orders/:orderId/status` with `{status: 'DELIVERED'}` and updates that row in place.
**Backend interaction:** `GET /clubs`, `GET /orders/club`, `GET /catalog?clubId=`, `PATCH /orders/:orderId/status`.
**Expected behavior:** Marking an order delivered updates its status and fires an `ORDER_DELIVERED` notification to the student. The item column shows a real name; the student column shows their email.
**How to verify:** As a student, check `/orders` after the admin marks an order delivered — confirm both the order's status (Step 25) and a new notification on `/notifications` (Step 26) reflect it.
**Why are we doing it this way?** `GET /orders/club` only ever returned `catalog_item_id` and `user_id` — genuinely not enough to identify "which item, which student" at a glance, which is the whole point of this page. Item name is resolved client-side (via the already-fetched club item list) since that's free — no backend change needed. Student email required a backend change: `student_email` is now denormalized onto the `orders` row at checkout time (same reasoning as `club_id` before it — the checkout handler already has the caller's email from their JWT, so this avoids a cross-service lookup on every read). See `services/order-service/db/migrate7.js` and `backfillStudentEmail.js`.

#### Step 32 — (Super Admin only) Build the Promote User page
**Goal:** Demonstrate the RBAC/tenant-isolation promotion capability.
**Files involved:** new `frontend/src/pages/PromoteUserPage.jsx`; `App.jsx` (add `/admin/promote`, restricted to `SUPER_ADMIN` only); `Navbar.jsx` (add a Promote User link, Super Admin only).
**Concepts I will learn:** nothing new — a two-step form (look up, then act on the result).
**Implementation:** An email text input + "Find" button calls `GET /users/lookup?email=`; on `200`, show the found user's current `full_name`/`role`/`club_id` plus a role `<select>` (STUDENT/CLUB_ADMIN/SUPER_ADMIN) and — shown only when the selected role is `CLUB_ADMIN` — a club `<select>` (from this page's own `GET /clubs` fetch); on `404`, show "No user with that email." An "Update Role" button submits `PUT /users/:userId/role` using the `id` from the lookup response. If the looked-up user already has a non-null `club_id`, a warning is shown above the form (not blocking it) explaining they need to be set to `STUDENT` first before being assigned a different club — the form stays usable either way, since demoting *is* a legitimate action through this same form.
**Backend interaction:** `GET /clubs`, `GET /users/lookup?email=`, `PUT /users/:userId/role`.
**Expected behavior:** Looking up a freshly-registered student's email, selecting `CLUB_ADMIN` and a club, and promoting lets that account subsequently manage that club. Looking up a user who's already a Club Admin for another club and attempting to reassign them returns `400` — they must be set to `STUDENT` first.
**How to verify:** Register a throwaway account (Step 13), look it up here by email, promote it, log in as it, confirm the admin pages now show that club. Then, as Super Admin, look that same (now-Club-Admin) user up again and attempt to assign them to a *different* club — confirm it's rejected with `400`.
**Why are we doing it this way?** An email lookup is simpler and more natural for an admin to use than pasting a raw UUID, and required only a minimal exact-match endpoint (`GET /users/lookup`) rather than a full user directory/search feature — which stays explicitly out of scope (§15).

#### Step 33 — (Super Admin only) Build the Create Club page
**Goal:** Let the Super Admin onboard a new club, per the finalized requirement (`REQUIREMENTS.md` FR5.3) that clubs are no longer fixed/pre-seeded-only data.
**Files involved:** new `frontend/src/pages/CreateClubPage.jsx`; `App.jsx` (add `/admin/create-club`, restricted to `SUPER_ADMIN` only); `Navbar.jsx` (add a Create Club link, Super Admin only).
**Concepts I will learn:** nothing new — another controlled form, same shape as Step 29's create-item form.
**Implementation:** Three fields: club name, description, and the new Club Admin's email. Submits `POST /clubs`. On success, show the created club and its assigned admin. On `400`/`404`/`409`, show the backend's message directly (e.g. "No user found with that admin_email", "User is already assigned to a club...", "A club with that name already exists").
**Backend interaction:** `POST /clubs`.
**Expected behavior:** Creating a club with a `STUDENT`'s email promotes that student to `CLUB_ADMIN` for the new club in one action; the new club is immediately selectable from `useClubContext`'s dropdown on the other admin pages afterward (it fetches `GET /clubs` fresh on each page visit).
**How to verify:** Register a second throwaway account (Step 13), create a club naming it as admin, confirm it appears in `GET /clubs`, then log in as that account and confirm the Create Item page now shows it as their club.
**Why are we doing it this way?** Club creation and admin assignment happen in a single backend call (one DB transaction), so the form mirrors that exactly — no separate "create club" then "assign admin" steps to keep in sync on the frontend.

### Phase 9 — Final Manual QA Pass

#### Step 34 — End-to-end walkthrough with all three roles
**Goal:** Confirm every flow works together, not just in isolation.
**Files involved:** none (manual QA).
**Concepts I will learn:** how to structure a manual test pass.
**Implementation:** Using the pre-seeded accounts documented in the root `.env` comments (one Student, one Club Admin, the Super Admin), walk through: register a new student → log in → browse catalog → check out an item → see it in your orders → (as that item's Club Admin) set a delivery slot and mark the order delivered → (as the student again) confirm both notifications arrived. Then, as Super Admin: create a new club assigning a freshly-registered student as its admin, look up an existing user by email and promote them, and confirm both newly-promoted accounts can use the `/admin/*` pages for their respective clubs.
**Backend interaction:** All of it.
**Expected behavior:** No dead ends, no unhandled errors in the browser console.
**How to verify:** The walkthrough itself is the verification.
**Why are we doing it this way?** Individual steps were verified in isolation throughout — this final pass is what catches integration gaps between them (e.g. a stale club selection carried over between admin actions).

#### Step 35 — Stop
**Goal:** Recognize the finish line.
**Files involved:** none.
**Concepts I will learn:** none — this is a discipline step, not a technical one.
**Implementation:** N/A.
**Backend interaction:** N/A.
**Expected behavior:** N/A.
**How to verify:** N/A.
**Why are we doing it this way?** See §16, Definition of Done. Once Step 34 passes, resist the urge to add polish — the frontend has fully served its purpose.

---

## 13. Learning Opportunities

### MUST UNDERSTAND
- Function components, JSX, props
- `useState` (every page uses it for form fields and fetch results)
- `useEffect` + its dependency array + its cleanup function (data fetching, and critically the notification polling interval)
- Controlled form inputs (`value` + `onChange`)
- `async`/`await` with `fetch`, and `try/catch` for error handling
- HTTP methods and what each is used for here (`GET` read, `POST` create, `PUT` full-field update, `PATCH` partial/status update)
- HTTP status codes actually returned by this backend (`200/201/400/401/403/404/409/429/500/503`) and the `Retry-After` header
- React Router: `<Routes>`/`<Route>`, `<Link>`, `useNavigate`, `useParams`, `<Navigate>`
- React Context: `createContext`, `useContext`, a Provider component — via the one real use case in this app (auth)
- Conditional rendering (`{condition && <X/>}`, ternaries) — used constantly for role checks and loading/error/empty states
- Rendering lists with `.map()` and the `key` prop
- `localStorage` (get/set/remove)
- What a JWT is structurally (three base64 segments) and why decoding it client-side is safe for reading claims but not for trust decisions

### NICE TO KNOW
- `crypto.randomUUID()`
- Array methods beyond `.map()`: `.filter()`, `.find()`, `.includes()`
- Destructuring and the spread/rest operators (used throughout the example snippets in this plan)
- Optional chaining (`?.`) and nullish coalescing (`??`)
- `Promise`-wrapped `setTimeout` for a manual delay (used in the checkout retry loop)
- Why a backend rate limiter/lock uses a header like `Retry-After` instead of a hardcoded client delay

### SKIP
- Redux, Zustand, or any global state library — Context covers the one case that needs it
- TanStack Query / SWR or any server-state caching library
- Tailwind or any CSS framework/CSS-in-JS
- Axios or any HTTP client library beyond native `fetch`
- TypeScript
- `useReducer` — the checkout flow is deliberately kept to plain `useState` flags
- `useMemo`/`useCallback` — nothing in this app is expensive enough to need memoization
- WebSockets/Server-Sent Events — the backend has none; polling is used instead
- Testing frameworks (Jest/Vitest/React Testing Library) — manual QA (Phase 9) is the verification method for this project
- Any component/design-system library (MUI, Chakra, shadcn, etc.)
- Animation libraries
- Server-side rendering / Next.js — this is a client-only SPA talking to an existing API

---

## 14. Final Frontend Scope

- Register / Login / Logout, JWT persisted across refresh
- Browse catalog with type/club filters and cursor pagination
- View item detail with automatic preferred-size injection and manual fallback when unavailable
- Checkout with idempotency key, automatic retry on lock contention and rate limiting, and clear terminal states (success / out of stock / payment failed)
- Profile, Orders, and Notifications pages: edit profile & saved size, view order history, view and acknowledge notifications (polled)
- Club Admin / Super Admin dashboard: create merchandise, set delivery slots, view and fulfill (mark delivered) the club's orders
- Super Admin: look up a user by email and promote them to `CLUB_ADMIN`; create a new club while assigning its admin by email

## 15. Intentionally Excluded

- Zustand/Redux, TanStack Query, Tailwind, Axios, any component library — plain React/CSS/fetch is sufficient at this scale
- The "Architectural Telemetry Drawer" from the old spec doc — a nice portfolio flourish, but pure extra frontend complexity with zero backend-correctness value
- A Super Admin "Diagnostics Panel" (health matrix / circuit breaker badge / queue depth) — **the backend implements none of this** (no `/health/detailed`, no `opossum` dependency anywhere); building the UI for it would mean either faking data or building backend features under the guise of a frontend task
- Real-time via WebSocket/SSE — backend has no such endpoint; polling is used instead
- A dynamic "Factory Pattern" form that grows extra fields per merchandise type (volume, material, etc.) — those fields are optional and freeform server-side; a demo doesn't need to expose them
- A full user directory/search/listing UI — only a minimal exact-match `GET /users/lookup?email=` exists (added specifically to back the promotion form), not a browsable user list
- Order cancellation UI — no backend endpoint exists for it
- Automated tests (unit/e2e) — manual QA per Phase 9 is this project's verification method
- Dark mode, animations, responsive breakpoints beyond a centered max-width column
- Any "fix" to the backend RBAC/auth gaps found in §4 — those are backend tickets, noted here only so the frontend design accounts for them

## 16. Final File Structure

```
frontend/
├── .env                      (gitignored — VITE_API_BASE_URL)
├── .env.example              (committed template)
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx               (entry: BrowserRouter > AuthProvider > App)
    ├── App.jsx                (Routes + Navbar)
    ├── Navbar.jsx
    ├── ProtectedRoute.jsx
    ├── AuthContext.jsx        (AuthProvider, useAuth, decodeJwt)
    ├── useClubContext.js      (hook: resolves the acting club for admin pages)
    ├── ClubPicker.jsx         (renders useClubContext's result)
    ├── api.js                 (apiFetch)
    ├── index.css
    └── pages/
        ├── LoginPage.jsx
        ├── RegisterPage.jsx
        ├── CatalogPage.jsx
        ├── ItemDetailPage.jsx
        ├── ProfilePage.jsx
        ├── OrdersPage.jsx
        ├── NotificationsPage.jsx
        ├── CreateItemPage.jsx
        ├── DeliverySlotsPage.jsx
        ├── ClubOrdersPage.jsx
        ├── PromoteUserPage.jsx
        └── CreateClubPage.jsx
```

19 source files. Profile/Orders/Notifications became three separate files instead of one shared `DashboardPage.jsx` (Phase 7 revision note), and the same happened to `AdminPage.jsx` → five pages + `useClubContext.js` + `ClubPicker.jsx` (Phase 8 revision note). No `hooks/`, `services/`, or `utils/` directories — the two shared admin files just sit flat under `src/` rather than in their own folder, since there are only two of them. Tailwind is wired via `@tailwindcss/vite` in `vite.config.js` and a one-line `@import "tailwindcss";` in `index.css` — no separate Tailwind config file needed (v4's zero-config setup).

## 17. API Dependency Map

```
LoginPage / RegisterPage
      ↓
POST /users/login | /users/register
      ↓
user-service (Postgres)

CatalogPage
      ↓
GET /catalog?cursor&type&clubId   +   GET /clubs (for filter dropdown)
      ↓
catalog-service (MongoDB + Valkey cache)  /  user-service (Postgres)

ItemDetailPage
      ↓
GET /catalog/:id   +   GET /users/profile/:id   →   POST /orders (Idempotency-Key)
      ↓                                                    ↓
catalog-service (MongoDB)   user-service (Postgres)   order-service (Postgres + Valkey lock)
                                                              ↓ (fire-and-forget)
                                                        RabbitMQ "order.placed"
                                                              ↓
                                                        notification-service (Postgres)

ProfilePage
      ↓
GET/PUT /users/profile/:id
      ↓
user-service (Postgres)

OrdersPage
      ↓
GET /orders
      ↓
order-service (Postgres)

NotificationsPage
      ↓
GET/PATCH /notifications (polled every 15s)
      ↓
notification-service (Postgres)

CreateItemPage (useClubContext: GET /clubs)
      ↓
POST /catalog
      ↓
catalog-service (MongoDB)

DeliverySlotsPage (useClubContext: GET /clubs)
      ↓
GET /catalog?clubId=   →   PUT /catalog/:id/delivery-slot
      ↓                              ↓
catalog-service (MongoDB)   catalog-service (+ RabbitMQ "delivery.slot.updated" → notification-service)

ClubOrdersPage (useClubContext: GET /clubs)
      ↓
GET /orders/club   +   GET /catalog?clubId= (item names)   →   PATCH /orders/:id/status
      ↓                              ↓                                    ↓
order-service (Postgres,           catalog-service                order-service (+ RabbitMQ "order.delivered"
incl. denormalized                 (MongoDB)                       → notification-service)
student_email)

PromoteUserPage
      ↓
GET /clubs   →   GET /users/lookup?email=   →   PUT /users/:id/role
      ↓                    ↓                              ↓
user-service        user-service                   user-service

CreateClubPage
      ↓
POST /clubs (transactional: club + admin)
      ↓
user-service (Postgres)
```

## 18. Implementation Order (flat list)

1. Create Vite React project
2. Configure environment variables
3. Strip boilerplate, add plain CSS
4. Install & configure React Router
5. Create placeholder pages
6. Wire up `<Routes>`
7. Build `apiFetch` helper
8. Build `AuthContext`
9. Wrap app in `AuthProvider`
10. Build `ProtectedRoute`
11. Wrap protected routes
12. Build `Navbar`
13. Register form
14. Login form
15. Verify auth persistence + logout
16. Fetch and list catalog items
17. Add type/club filters
18. Add cursor pagination
19. Fetch and display item detail
20. Resolve preferred size vs. availability
21. Build checkout form (no submit logic)
22. Wire checkout submit — happy path + terminal errors
23. Add retry handling — lock contention + rate limit
24. Profile page (view + edit)
25. Orders page
26. Notifications page
27. Poll notifications
28. Admin page skeleton + club context
29. Create-item form
30. List club items + set delivery slot
31. Club orders + mark delivered
32. (Super Admin) Role promotion form
33. (Super Admin) Create Club form
34. End-to-end manual QA walkthrough
35. Stop

## 19. Estimated Effort

Assuming genuine beginner-to-React status, working alone, backend already running and stable:

| Phase | Steps | Learning time | Implementation time | Debugging/testing time |
|---|---|---|---|---|
| 1 — Setup | 1–3 | 1–2 hrs (Vite/React basics) | 1 hr | 0.5 hr |
| 2 — Routing | 4–6 | 1 hr (React Router) | 1 hr | 0.5 hr |
| 3 — Auth foundation | 7–12 | 2–3 hrs (Context, fetch patterns) | 2–3 hrs | 1 hr |
| 4 — Register/Login | 13–15 | 0.5 hr | 1.5 hrs | 1 hr |
| 5 — Catalog | 16–18 | 0.5 hr | 2 hrs | 1 hr |
| 6 — Checkout | 19–23 | 1 hr (retry/Retry-After concept) | 3–4 hrs | 2–3 hrs (this is the fiddliest part — needs two browser sessions to see lock contention) |
| 7 — Account pages | 24–27 | 0.5 hr | 2–3 hrs | 1 hr |
| 8 — Admin | 28–33 | 0.5 hr | 3.5–4.5 hrs | 1.5 hrs |
| 9 — QA | 34–35 | — | — | 1–2 hrs |
| **Total** | | **~7–9 hrs** | **~16–20 hrs** | **~9–11 hrs** |

**Overall: roughly 3–5 focused working days** for someone new to React, comfortably less for anyone with prior frontend exposure. This is intentionally a small fraction of the multi-day backend build this project already represents — consistent with the stated priority that the frontend is a means to an end.

## 20. Definition of Done

The frontend is **done** when:

1. All six pages exist and are reachable per the route table in §5.
2. A new student can register, log in, and stay logged in across a page refresh.
3. A student can browse, filter, and paginate the catalog, and complete a checkout end-to-end (success case with `4242`, failure case with any other value, out-of-stock case).
4. A student's Profile, Orders, and Notifications pages show their real profile, real order history, and real notifications (including at least one flow where a notification arrives from an admin action taken in a different session).
5. A Club Admin can create an item, set a delivery slot, and mark one of their club's orders delivered — all scoped to their own club only.
6. A Super Admin can do everything a Club Admin can for any club (via the club selector) and can promote a user by UUID.
7. Step 34's full manual walkthrough passes with no unhandled errors in the browser console.

**At that point, stop.** Do not add: automated tests, animations, a design system, TypeScript, real-time transport, or additional admin screens. If a future need arises that genuinely requires one of these, it should be a deliberate, separately-scoped decision — not a default continuation of "polishing" a frontend that has already fully served its purpose of proving the backend works.
