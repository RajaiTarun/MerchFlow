# Frontend Specification Document

**Project:** Centralized College Merchandise Management System

**Document Version:** 2.0

**Status:** Describes the implemented frontend (`frontend/src/`)

**Architecture:** React single-page app talking only to the API Gateway

**Revision note (2026-10-24):** rewritten to match the shipped frontend.
- **Removed (never built):**
  - the "Architectural Telemetry Drawer" and its cache-latency footers and colored badges
  - TanStack Query, Zustand and Axios
  - per-size "sold out" handling (stock is one counter per item)
  - SSE
  - a `/dashboard` and per-tier admin pages
  - the sprint timeline
  - every latency figure
- **Corrected:** the route map, the API paths, the checkout retry contract, and how sessions are stored.

---

## 1. UI Philosophy

The frontend exists to drive and show off the backend: distributed locking, idempotency, saga rollback, role-based access, and event-driven notifications. It favors clarity over visual polish:
* plain Tailwind utility styling, with no component library or custom animation;
* every backend outcome (success, out of stock, lock contention, rate limit, payment failure, size fallback) surfaced as plain, readable text.

There is no dedicated telemetry or diagnostics UI.

---

## 2. Technical Stack & Client Architecture

* **Framework:** React 19, built with Vite.
* **Routing:** React Router 7, with a `ProtectedRoute` wrapper that checks the logged-in user's role per route. The API Gateway enforces the same rules server-side regardless.
* **State:** React state plus an `AuthContext` for the session.
  * The JWT is kept in `localStorage`.
  * On load, the context restores the token and discards it if it has expired.
  * A `useClubContext` hook resolves which club an admin page acts on: the Club Admin's own club, or the club a Super Admin picks with `ClubPicker`.
* **Styling:** Tailwind CSS 4 (via `@tailwindcss/vite`).
* **HTTP client:** a small `apiFetch` wrapper around `fetch` in `api.js`. It:
  * prefixes the gateway base URL (`VITE_API_BASE_URL`);
  * attaches `Authorization: Bearer <jwt>`;
  * turns error responses into errors carrying the backend's error code and any `Retry-After` value.
* **Free-tier wake-up handling:** Render's free services sleep when idle.
  * On app load, the frontend calls the gateway's `/warmup` endpoint so the backend services start waking in parallel.
  * If a request fails because a service is still asleep (network error, `502` or `503`), `apiFetch` waits 30 seconds and retries, at most twice. It only does this for requests that are safe to replay: `GET`s, and requests carrying an `Idempotency-Key`.
  * While a retry is pending, a `WakingBanner` tells the user the backend is starting up.

---

## 3. Route Structure

```
/                      → redirects to /catalog
/login                 (public)
/register              (public)

[Any logged-in user]
  /catalog             Unified feed with type and club filters
  /catalog/:id         Item detail and checkout
  /profile             Profile and preferred size
  /orders              Own order history
  /notifications       Own notifications

[Club Admin + Super Admin]
  /admin/create-item     Publish an item
  /admin/delivery-slots  Set delivery slots on a club's items
  /admin/orders          A club's orders; mark delivered

[Super Admin only]
  /admin/promote       Look up a user by email and promote them
  /admin/create-club   Create a club and assign its admin
```

The 12 pages live in `frontend/src/pages/`. The `Navbar` shows only the links the current role can use.

---

## 4. View Specifications

### 4.1 Register & Login (`/register`, `/login`)
* **Register:** collects full name, email, and password. The email is checked in the browser against `^[a-zA-Z0-9._%+-]+@students\.iiit\.ac\.in$` before submitting, and the User Service enforces the same rule. Calls `POST /api/v1/users/register`. The preferred size is set later, on the profile page.
* **Login:** calls `POST /api/v1/users/login` and stores the returned JWT.

### 4.2 Catalog Feed (`/catalog`)
* **Filters:** dropdowns for item type (`APPAREL`, `MUG`, `ACCESSORY`) and club. The club list comes from `GET /api/v1/clubs`.
* **Grid:** cards with item name, club, price, and stock.
* **Pagination:** a "Load More" button passes the backend's `nextCursor` back as `?cursor=`, so pagination is cursor-based rather than offset-based.
* **Backend:** `GET /api/v1/catalog?cursor=&type=&clubId=`. The unfiltered first page is served from the Valkey cache when it is warm.

### 4.3 Item Detail & Checkout (`/catalog/:id`)
* **Details:** name, description, price, stock, available sizes, and the delivery slot if one is set. Stock refreshes by polling while the page is open.
* **Size selection:** the page loads the item and the student's profile together.
  * If the student's preferred size is one of the item's available sizes, it is pre-selected.
  * If it isn't, or no preferred size is saved, the page asks the student to pick from the available sizes before they can check out.
  * The chosen size is sent as `selectedSize`.
  * The backend re-checks the size, and its `PREFERRED_SIZE_UNAVAILABLE`, `NO_PREFERRED_SIZE` and `SELECTED_SIZE_UNAVAILABLE` replies bring the picker back as a safety net.
  * Items with no sizes (mugs) skip this.
* **Quantity** and a **mock card number** input. The placeholder reads: `4242` = success, anything else = failure.
* **Checkout request:** `POST /api/v1/orders` with body `{ catalogItemId, quantity, mockCardNumber, selectedSize? }` and an `Idempotency-Key` header. The button is disabled while a checkout is in progress.

### 4.4 Profile (`/profile`)
* View and update full name, phone, hostel block, and preferred size (`S`–`XXL`). It loads from `GET /api/v1/users/profile/:userId` and saves changed fields with a partial `PUT /api/v1/users/profile`. A size-only endpoint, `PUT /api/v1/users/size`, also exists on the backend.

### 4.5 Orders (`/orders`)
* The student's own orders (item, size, quantity, status, date), from `GET /api/v1/orders`.

### 4.6 Notifications (`/notifications`)
* The user's notifications, newest first, from `GET /api/v1/notifications`. They cover orders placed, orders delivered, and delivery slots set on items the user ordered.
* The list refreshes by polling. There is no SSE or WebSocket push.
* **Mark as read:** `PATCH /api/v1/notifications/:id/read`.

### 4.7 Create Item (`/admin/create-item`)
* **Form fields:** type, name, description, price, stock, and, for apparel and accessories, the available sizes.
* **Club:** Club Admins publish for their own club; a Super Admin picks the club first.
* Calls `POST /api/v1/catalog`, where the backend builds the item through its Factory.

### 4.8 Delivery Slots (`/admin/delivery-slots`)
* Lists the club's items and lets the admin set a date and time window on each.
* Calls `PUT /api/v1/catalog/:id/delivery-slot`. The backend then notifies every student who ordered that item.

### 4.9 Club Orders (`/admin/orders`)
* The club's orders with student email, item, size, quantity, and status, from `GET /api/v1/orders/club`. A Super Admin passes `?clubId=` for the club they picked.
* **Mark delivered:** a "Mark delivered" action calls `PATCH /api/v1/orders/:orderId/status` with `DELIVERED`, which notifies the student.

### 4.10 Promote User (`/admin/promote`, Super Admin)
* An email input calls `GET /api/v1/users/lookup?email=` and shows the matched user's name, role, and club.
* A promote action calls `PUT /api/v1/users/:userId/role`. If the user already belongs to a club, the page says so instead of attempting a reassignment the backend would reject.

### 4.11 Create Club (`/admin/create-club`, Super Admin)
* A form for club name, description, and the new Club Admin's email. It calls `POST /api/v1/clubs`, which creates the club and assigns the admin in one transaction.

Application-level administration only: there is no service-health, queue, or circuit-breaker view anywhere in the frontend.

---

## 5. Checkout Retry Contract

Checkout runs as an explicit state machine in `ItemDetailPage.jsx`:

```
IDLE ──Place Order──► PLACING_ORDER ──201──► SUCCESS
                          │
                          ├─409 LOCK_CONTENTION_DETECTED ─┐
                          ├─429 RATE_LIMITED ─────────────┤──► RETRYING ──wait──► PLACING_ORDER
                          │                               │    (same Idempotency-Key)
                          ├─409 OUT_OF_STOCK ──► OUT_OF_STOCK
                          ├─400 PAYMENT_FAILED ──► FAILED ("saga rollback restored the reserved stock")
                          ├─400 size codes ──► IDLE (size picker shown)
                          └─anything else ──► FAILED
```

* **One idempotency key per checkout attempt:** the key is generated once with `crypto.randomUUID()` when the student clicks Place Order, and every retry of that attempt reuses it. The backend therefore never creates a second order for the same click.
* **Retryable responses only:** `LOCK_CONTENTION_DETECTED` (`409`) and `RATE_LIMITED` (`429`).
* **Wait time:** the backend's `Retry-After` header plus up to 300 ms of random jitter, so clients don't all retry at the same instant. The order service sends `Retry-After: 1` on lock contention; the gateway sends the bucket's remaining window on `429`.
* **Bounded:** at most 3 attempts in total. After that the checkout ends in `FAILED` with a "try again" message. While retrying, the page shows "Retrying… (attempt N of 3)".
* **Terminal states:** `SUCCESS`, `OUT_OF_STOCK` and `FAILED` end the attempt and re-enable the button.
