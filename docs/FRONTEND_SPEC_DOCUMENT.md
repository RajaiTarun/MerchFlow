# Frontend Specification Document

**Project:** Centralized College Merchandise Management System

**Document Version:** 1.0

**Status:** Approved for Engineering Sprint

**Target Architecture:** Decoupled Microservices Client (React / Vite)

---

## 1. Executive Summary & UI Philosophy

### 1.1 "Function Over Form" Principle

Given the strict **7-to-9 day sprint constraint** and the explicit project goal of showcasing senior-level backend engineering (LLD, HLD, distributed concurrency, and fault tolerance), the frontend architecture strictly prioritizes **mechanical clarity over visual polish**.

The frontend will act as a lightweight, high-performance web dashboard. It will expend zero engineering hours on complex CSS animations, custom graphic design, or intricate UI micro-interactions. Instead, it will use clean, utilitarian styling to clearly display system states, network payloads, error boundaries, and real-time backend events.

### 1.2 The "System Design Live-Telemetry" Differentiator

To turn this frontend into a portfolio showpiece for backend interviews, the UI will feature a collapsible **"Architectural Telemetry Drawer."**
When enabled, this UI component will display a live stream of what is happening under the hood during user actions: showing API Gateway routing hops, Valkey lock acquisitions, HTTP status codes, and asynchronous RabbitMQ event deliveries in real time.

**Revision note (2026-09-14):** the Telemetry Drawer was not built, and none of §4's per-view "telemetry badge" language below (cache-hit millisecond footers, colored Saga/lock-contention/rate-limit toast badges) shipped either — the actual frontend (`frontend/src/pages/`) surfaces these same backend states as plain success/error text, not as a dedicated diagnostics UI. The route structure in §3 is also more granular in the shipped app than described below: `/dashboard` became three separate pages (`/profile`, `/orders`, `/notifications`), and `/admin/club` and `/superadmin/root` became five separate `/admin/*` pages, each protected per-role by `ProtectedRoute` rather than one combined admin view per tier. This file otherwise still accurately describes the checkout flow, size-fallback behavior, and retry/backoff contract, which did ship as specified.

---

## 2. Technical Stack & Client Architecture

To minimize setup friction and bundle size during the sprint, the frontend stack relies on modern, zero-config tooling:

* **Core Framework:** **React 18** bootstrapped via **Vite** (provides sub-second local server start times and instant Hot Module Replacement).
* **State Management:** **Zustand** or **React Context API**. (Avoid Redux; Zustand provides lightweight, boilerplate-free global state for user authentication sessions and saved sizing profiles).
* **Data Fetching & Caching:** **TanStack Query (React Query)**. Handles server-state caching, automatic background refetching, and clean loading/error states when communicating with the API Gateway.
* **Styling Framework:** **Tailwind CSS**. Utility-first styling allows rapid layout construction (flexbox, CSS grids, simple forms) without writing or debugging custom `.css` files.
* **HTTP Client:** **Axios** configured with global interceptors to automatically inject JWT Bearer tokens, attach client-generated Idempotency Keys, and intercept `429 Too Many Requests` rate-limiting errors.

---

## 3. Information Architecture & Route Structure

The application routes are strictly mapped to the three Role-Based Access Control (RBAC) tiers established in our Security Specification:

```
[Root: /]
  ├── /login                  (Authentication Screen)
  ├── /register               (Domain-Restricted Onboarding)
  │
  ├── [Student Tier]
  │     ├── /catalog          (Unified Feed & Category Filters)
  │     ├── /catalog/:id      (Item Detail & Checkout Modal)
  │     └── /dashboard        (Saved Size Profile, Orders, & In-App Notifications)
  │
  ├── [Club Admin Tier]
  │     └── /admin/club       (Merchandise Management & Flash Sale Inventory Caps)
  │
  └── [Super Admin Tier]
        └── /superadmin/root  (Application Administration: user lookup/promotion, club creation)

```

---

## 4. Core View Specifications & Component Breakdown

### 4.1 View 1: Auth & Onboarding Screen (`/register`, `/login`)

* **Purpose:** Enforces domain validation and constructs the user profile object using the backend Builder Pattern.
* **Key UI Components:**
* **Email Input Field:** Includes real-time client-side regex validation against `^[a-zA-Z0-9._%+-]+@students\.iiit\.ac\.in$`. Displays a clear visual error if an unauthorized domain is entered.
* **Size Profile Selector:** A radio button group (`S`, `M`, `L`, `XL`, `XXL`) allowing the student to save their global sizing preference upon onboarding.


* **Backend Interaction:** Submits payload to `POST /api/v1/auth/register` on the User Service via the API Gateway. Stores the returned JWT in secure browser storage.

### 4.2 View 2: Unified Catalog Feed (`/catalog`)

* **Purpose:** Demonstrates high-speed reading from the MongoDB catalog database and the Valkey caching layer.
* **Key UI Components:**
* **Filter Bar:** Simple dropdowns to filter by Club Name or Merchandise Type (T-shirt, Hoodie, Mug, Cap).
* **Merchandise Grid:** Displays cards featuring item name, club badge, price, dynamic attributes, and an **Real-Time Stock Counter Badge**.
* **Cursor Pagination Footing:** "Load More" button utilizing cursor-based pagination strings returned by the backend, avoiding offset degradation.


* **Backend Interaction:** Calls `GET /api/v1/catalog?cursor={next_cursor}`. Demonstrates Valkey cache hits via sub-50ms network response times.

### 4.3 View 3: Checkout Modal & Out-of-Stock Fallback Flow (`/catalog/:id`)

* **Purpose:** The primary interface for testing distributed locks, size injection, idempotency, and Saga rollbacks.
* **Key UI Components:**
* **Auto-Injected Size Badge:** Automatically highlights the student's pre-saved preferred size fetched from global state.
* **Out-of-Stock Interception Alert:** If the pre-saved size has `0` inventory, the UI dynamically disables the default selection, displays a prominent yellow warning banner (*"Your preferred size [L] is currently out of stock for this drop"*), and forces manual selection of remaining available sizes.
* **Mock Payment Input (Magic Values):** A simple text input labeled `"Mock Card Number (Enter 4242 for Success, 4000 for Failure)"`.
* **Idempotency Execution Button:** A "Complete Order" button that generates a unique `crypto.randomUUID()` string on mount and attaches it to the request header.


* **Backend Interaction:** Submits `POST /api/v1/orders` with header `Idempotency-Key: {uuid}`.

```
┌─────────────────────────────────────────────────────────────┐
│ CHECKOUT MODAL: Limited Edition Tech Club Hoodie            │
├─────────────────────────────────────────────────────────────┤
│ Price: ₹799 | Available Stock: 12 units                     │
│                                                             │
│ [!] Out-of-Stock Fallback Interception:                     │
│ ⚠️ Your saved size [L] is SOLD OUT. Please select below:     │
│                                                             │
│ Select Size:  ( ) S    ( ) M    (X) L [SOLD OUT]    (*) XL  │
│                                                             │
│ Mock Payment Card: [ 4000                                 ] │
│ 💡 Tip: Type 4242 for Success, 4000 to test Saga Rollback     │
│                                                             │
│               [ CANCEL ]        [ COMPLETE ORDER ]          │
└─────────────────────────────────────────────────────────────┘

```

### 4.4 View 4: Student Dashboard & In-App Notifications (`/dashboard`)

* **Purpose:** Demonstrates relational data retrieval from PostgreSQL and asynchronous event consumption from RabbitMQ.
* **Key UI Components:**
* **Profile Manager Card:** Allows updating the global Saved Size profile (`PUT /api/v1/users/size`).
* **Order History Table:** Displays past transactions, timestamps, payment states (`COMMITTED` vs `ABORTED_SAGA_ROLLBACK`), and item details.
* **In-App Notification Feed:** A live polling or Server-Sent Events (SSE) feed displaying real-time delivery time slots and distribution location updates generated by the Notification Service.



### 4.5 View 5: Club Admin Management Dashboard (`/admin/club`)

* **Purpose:** Tenant-scoped dashboard for creating items and triggering flash sales.
* **Key UI Components:**
* **Item Creation Form (Factory Pattern UI):** A dynamic form that changes attribute fields based on the selected merchandise type (e.g., selecting "Mug" replaces clothing size dropdowns with a "Volume (ml)" text input).
* **Flash Sale Inventory Control:** Numeric inputs to set strict stock caps (e.g., setting stock to `50` units).
* **Broadcast Delivery Slot Modal:** Text area allowing Club Admins to publish delivery schedules (`POST /api/v1/notify`), which triggers asynchronous RabbitMQ broadcast events to subscribed students.



### 4.6 View 6: Super Admin Administration Panel (`/superadmin/root`)

* **Purpose:** Basic, functional application-level administration for the Super Admin — **not** an infrastructure diagnostics/observability tool. There is no circuit breaker, aggregated service-health matrix, or RabbitMQ queue-depth monitor anywhere in this system, and none is planned; that entire "Diagnostics Panel" concept from an earlier revision of this spec has been dropped from scope.
* **Key UI Components:**
* **User Lookup & Promotion:** An email text input + "Find" button calling `GET /api/v1/users/lookup?email=`. On a match, displays the user's name/current role/club and offers a "Promote to Club Admin" action (`PUT /api/v1/users/:userId/role`). If the user is already assigned to a club, the UI surfaces that plainly rather than letting the Super Admin attempt (and be rejected by) a reassignment.
* **Club Creation:** A form (club name, description, and the new Club Admin's email) submitting to `POST /api/v1/clubs`, which creates the club and assigns the specified user as its admin in one step. This replaces clubs being permanently fixed/pre-seeded data — Super Admins can create new ones through this panel.
* **Basic Overview:** Wherever the existing backend already supports it (e.g. `GET /clubs` for a club list), a simple read-only summary is fine. No new backend endpoints should be built solely to populate this overview — the panel's scope is user lookup/promotion and club creation, not a general-purpose admin dashboard.



---

## 5. Client-Side Resilience & Error Handling Mechanics

To ensure a smooth demonstration during high-concurrency testing, the frontend implements three specialized error-handling patterns:

### 5.1 Rate Limiting Interception (`429 Too Many Requests`)

When a student or automated load-testing script exceeds the Valkey Token Bucket rate limit:

* The Axios response interceptor catches the `429` status code.
* The UI prevents application crashing and displays a global toast notification: *"Rate limit exceeded. To protect server health during this drop, please wait [X] seconds before retrying."*
* Submit buttons are temporarily disabled using a countdown timer based on the `Retry-After` response header.

### 5.2 Deterministic Saga Rollback Visualization

When a user inputs Magic Value `4000` during checkout:

* The Order Service attempts the transaction, fails payment verification, triggers the asynchronous Saga compensating transaction to restore MongoDB inventory, and returns a `400 Bad Request` with a structured error payload.
* The frontend intercepts this specific payload and renders an **Educational Error State Badge**:
> *"🚨 Payment Verification Failed (Mock Value 4000 Detected). Saga Compensating Transaction executed successfully: Item hold released in Catalog Service, stock counter incremented back by +1 in MongoDB."*



### 5.3 Network Timeout & Retry Feedback

If an internal microservice experiences transient latency, TanStack Query executes automated exponential backoff retries. During this window, the UI displays a subtle visual indicator (*"Reconnecting to backend cluster... Attempt 2 of 3"*), preventing user confusion without freezing the interface.

---

🎫 Frontend Checkout — ORD-403 Follow-up Implementation

Related Ticket: ORD-403 — High-Concurrency Valkey Distributed Locking

Purpose: Build the frontend checkout flow so that it correctly works with the backend's idempotency, distributed locking, rate limiting, Retry-After, and stock protection.

1. Generate Idempotency-Key once per checkout attempt

When the user clicks Place Order, generate one UUID:

User clicks Place Order
        ↓
Generate UUID
        ↓
idempotencyKey = abc-123
        ↓
Send request

If the request needs to be retried:

Retry #1 → abc-123
Retry #2 → abc-123
Retry #3 → abc-123
⚠️ Critical rule

Never generate a new UUID during a retry.

The idempotency key represents the entire checkout attempt, not an individual HTTP request.

2. Disable "Place Order" button

Immediately after the user clicks:

Place Order
     ↓
disabled = true

This prevents:

double click
    ↓
two checkout attempts

The frontend should not rely exclusively on this, however.

The backend's idempotency + distributed lock remains the actual safety mechanism.

3. Checkout State Machine

Maintain an explicit checkout state.

                ┌──────────────┐
                │    IDLE      │
                └──────┬───────┘
                       │
                Place Order
                       │
                       ▼
              ┌────────────────┐
              │ PLACING_ORDER  │
              └───────┬────────┘
                      │
          ┌───────────┼─────────────┐
          │           │             │
        201          409           429
          │           │             │
          ▼           ▼             ▼
       SUCCESS     RETRYING      RETRYING
                      │             │
                      └──────┬──────┘
                             │
                           retry
                             │
                             ▼
                     PLACING_ORDER

Terminal states:

SUCCESS
OUT_OF_STOCK
FAILED
States
State	Meaning
PLACING_ORDER	Initial checkout request is being processed
RETRYING	Waiting before automatically retrying
SUCCESS	Order successfully created
OUT_OF_STOCK	Inventory is exhausted
FAILED	Non-retryable/unexpected failure
4. Automatic Retry

The frontend should retry only specific responses.

Lock contention

Backend:

409 Conflict
Retry-After: 1
{
  "error": "LOCK_CONTENTION_DETECTED"
}

Frontend:

LOCK_CONTENTION_DETECTED
        ↓
read Retry-After
        ↓
wait
        ↓
retry SAME idempotency key
Rate limiting

Backend:

429 Too Many Requests
Retry-After: 20
{
  "error": "RATE_LIMITED",
  "retryAfter": 20
}

Frontend:

RATE_LIMITED
      ↓
read Retry-After
      ↓
wait
      ↓
retry SAME idempotency key
Do NOT retry

If backend returns:

{
  "error": "OUT_OF_STOCK"
}

then:

OUT_OF_STOCK
      ↓
stop retrying
      ↓
show "Out of stock"

Likewise, unexpected 4xx/5xx responses should generally transition to FAILED unless explicitly classified as retryable.

5. Retry Jitter

Don't make hundreds of clients retry at exactly:

12:00:01.000

because that can create another traffic spike.

Instead:

Retry-After = 1 second


Client A → 1.13 sec
Client B → 1.42 sec
Client C → 1.07 sec
Client D → 1.31 sec

Conceptually:

actualDelay =
    Retry-After
    + random jitter

The backend's Retry-After remains the base delay.

Jitter should only spread clients out slightly.

6. Maximum Retry Window

Never allow:

retry
 ↓
retry
 ↓
retry
 ↓
retry
 ↓
...

forever.

Define a maximum checkout retry window, for example:

Maximum retry window = 30 seconds

Then:

Checkout started
      ↓
retrying...
      ↓
30 seconds reached
      ↓
FAILED

The exact value can be decided when implementing the frontend.

7. Most Important Rule: Same Idempotency Key

The complete frontend flow should look like:

User clicks Place Order
        │
        ▼
Generate UUID ONCE
        │
        ▼
Disable button
        │
        ▼
state = PLACING_ORDER
        │
        ▼
POST /orders
Idempotency-Key: abc-123
        │
        ├───────────────┐
        │               │
       201             409/429
        │               │
        ▼               ▼
     SUCCESS         RETRYING
                        │
                  wait Retry-After
                        │
                   add jitter
                        │
                        ▼
                  POST /orders
                  Idempotency-Key:
                      abc-123
                        │
                        ▼
                      ...

The UUID stays abc-123 for the entire checkout attempt.

8. Backend Contract the Frontend Should Expect
Response	Frontend action
201	SUCCESS
409 + LOCK_CONTENTION_DETECTED	Wait Retry-After, retry
409 + OUT_OF_STOCK	OUT_OF_STOCK, stop
429 + RATE_LIMITED	Wait Retry-After, retry
Other 4xx	FAILED
Unexpected 5xx	FAILED unless explicitly made retryable
Headers

For retryable responses:

Retry-After: <seconds>

The frontend should use this value rather than hardcoding its own retry delay.

9. Final Acceptance Criteria for Frontend

When we eventually start frontend implementation, verify:

 UUID generated once per checkout attempt
 Same UUID used for every retry
 Place Order button disabled immediately after click
 Checkout state machine implemented
 LOCK_CONTENTION_DETECTED automatically retried
 RATE_LIMITED automatically retried
 Retry-After header respected
 Jitter added to retry delay
 Maximum retry window enforced
 OUT_OF_STOCK stops all retries
 Successful order transitions to SUCCESS
 Unexpected errors transition to FAILED
 Button/UI state restored appropriately after terminal state