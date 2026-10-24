# Product Requirements Document (PRD): Centralized College Merchandise Management System

**Document Version:** 2.0  
**Status:** Describes the implemented system  
**Architecture:** Polyglot Microservices with Event-Driven Communication  

**Revision note (2026-10-24):** rewritten to match what was actually built.
- **Removed:**
  - the circuit breaker and retry pattern for notification dispatch (never built)
  - real-time push (notifications are polled)
  - per-size stock (sizes are offered per item, and stock is a single counter)
  - the sprint timeline
  - every numeric KPI target and every unconfirmed measurement. Section 4 lists what will be measured. The one confirmed measurement so far, catalog cache hit vs. miss latency, is stated there with its environment.
- **Added:** club order management, delivery-slot notifications, order history, and the deployed setup (Docker Compose, Render).

---

## 1. Executive Summary & Problem Statement

### 1.1 Current Background
Within our college ecosystem, student clubs independently launch and distribute custom merchandise (such as T-shirts, hoodies, caps, and mugs) throughout the academic year. Today this workflow is entirely decentralized: each club uses its own forms, static size charts, and spreadsheets to manage orders and track payments.

### 1.2 The Problem
This decentralized approach creates friction across the campus:
* **For Students:** repetitive data entry across club forms, inconsistent sizing charts, and no central place to see active merchandise drops. High-demand "flash sales" can oversell inventory, which leads to manual cancellations.
* **For Club Administrators:** tracking inventory, orders, and campus delivery slots in spreadsheets causes administrative overhead, human error, and poor order tracking.

### 1.3 The Solution
The **Centralized College Merchandise Management System** is a single portal where clubs publish and sell their merchandise. It is built as a decoupled, polyglot microservices platform so it can double as a system design showcase. It provides:
* saved size profiles that are applied automatically at checkout;
* inventory protection under concurrent checkouts, using a distributed lock plus an atomic stock decrement;
* compensating rollbacks when a payment fails after stock was reserved;
* event-driven, in-app notifications for orders and delivery slots.

---

## 2. Target Audience & User Personas

| Persona | Primary Goal | Key Pain Points Addressed | System Role & Permissions |
| :--- | :--- | :--- | :--- |
| **The Student** (`@students.iiit.ac.in`) | Discover club merchandise and check out quickly without re-entering size details. | Repeated form filling, missed drops, sizing confusion, overselling. | Authenticated access. Manages their own profile (name, phone, hostel block, preferred size), browses the catalog, places orders, views their own orders and notifications. |
| **The Club Administrator** | Publish merchandise for their club, schedule distribution, and track their club's orders. | Spreadsheet tracking, oversold stock, chaotic distribution. | Scoped to their own club. Publishes items, sets delivery slots on their club's items, views their club's orders, and marks orders delivered. Can also place orders. |
| **The System Administrator (Super Admin)** | Onboard new clubs and promote trusted students to run them. | No self-service way for a club to join the platform without direct database access. | Platform-wide. Looks up any registered user by email, promotes a user to `CLUB_ADMIN`, and creates a new club while assigning its admin in the same action. Can also do what a Club Admin does for any club (naming the club explicitly), and can place orders. |

---

## 3. Core User Journeys & End-to-End Workflows

### 3.1 Journey 1: Student Onboarding & Saved Size Profile
* **Registration:** A student registers with a university email. The User Service accepts only addresses matching `^[a-zA-Z0-9._%+-]+@students\.iiit\.ac\.in$` and rejects any other domain with `403 Forbidden`. A duplicate email returns `409 Conflict`. Passwords are hashed with bcrypt before storage.
* **Login:** The User Service verifies the password and issues a signed JWT (1-hour expiry) carrying the user's id, email, role, and club id. The API Gateway verifies this token on every protected route.
* **Profile Construction:** The User Service uses the Builder Pattern (`StudentProfileBuilder`) to assemble the profile: full name, phone, hostel block, and preferred size (`S`, `M`, `L`, `XL`, `XXL`). Students can update the whole profile or just their size.
* **Persistence:** Profiles are stored in PostgreSQL. A user can only read or update their own profile, because the gateway derives their identity from the verified JWT.

```
[Student] ---> Register (@students.iiit.ac.in) ---> [API Gateway]
                                                           |
                                                           v
[PostgreSQL] <--- Save profile & preferred size <--- [User Service]
```

### 3.2 Journey 2: Catalog Publishing, Delivery Slots & Browsing
* **Publishing:** A Club Admin publishes an item with a name, description, price, initial stock, and type. The available types are `APPAREL`, `MUG` and `ACCESSORY`.
  * Apparel must list at least one available size.
  * Accessories may list sizes.
  * Mugs have none.

  The Catalog Service builds the item through the Factory Pattern (`MerchandiseFactory`) and stores it in MongoDB, whose document model fits these type-specific fields. A Super Admin can publish for any club by naming it; the club id is checked against the clubs table.
* **Delivery Slots:** A Club Admin sets a delivery date and time window on one of their own club's items. Every student who ordered that item receives an in-app notification (Journey 5).
* **Browsing:** Logged-in users browse one feed with items from all clubs.
  * The feed is newest-first, with cursor-based pagination.
  * It can be filtered by item type and club.
  * The unfiltered first page is cached in Valkey with a short expiry.
  * The cache is invalidated whenever an item is created, a delivery slot changes, or stock changes.
* **Not supported:** editing or deleting an item after it is published, apart from its delivery slot.

### 3.3 Journey 3: Order Placement & Automatic Size Selection
* **Order Initiation:** A student clicks "Buy Now". The Order Service fetches the student's saved profile from the User Service, and the item, including its available sizes, from the Catalog Service.
* **Automatic Size Selection:**
  * **Item has no sizes** (e.g., a mug): the order carries no size.
  * **Preferred size is offered for this item:** it is applied automatically.
  * **Preferred size is not offered, or no preferred size is saved:** checkout stops with `400` (`PREFERRED_SIZE_UNAVAILABLE` or `NO_PREFERRED_SIZE`) and returns the available sizes. The frontend shows them as a picker, and the student resubmits with a chosen size. A chosen size that isn't offered is rejected (`SELECTED_SIZE_UNAVAILABLE`).
* Sizes are *offered* per item. Stock is a single counter per item, not per size.

### 3.4 Journey 4: Concurrent Checkout & Saga Rollback
This is the core distributed-systems flow. A mock card number forces either the success or the failure branch on demand.

* **Idempotency (Order Service):** Checkout requires an `Idempotency-Key` header. The Order Service records the key in Valkey as `PROCESSING` before doing any work.
  * A retry after success gets the cached response back.
  * A duplicate sent while the first is still running gets `409`.
  * If checkout fails, the key is cleared so the student can try again.
* **Distributed Lock (Valkey):** The Order Service takes a per-item lock (`lock:item:{id}`) with a random token and an expiry. If another checkout holds the lock, the request gets `409 LOCK_CONTENTION_DETECTED`. The lock is released in a `finally` block, by a script that deletes it only if the token still matches.
* **Inventory Reservation:** The Catalog Service reserves stock with an atomic, conditional decrement: it only succeeds while stock covers the quantity. The reservation is recorded in the same MongoDB transaction. Insufficient stock returns `409 OUT_OF_STOCK`.
* **Payment Simulation:**

| Mock Card Input | Result | Backend Action |
| :--- | :--- | :--- |
| `4242` | `201 Created` | The order is saved in PostgreSQL with status `COMMITTED`, the Catalog Service commits the reservation, an `OrderPlaced` event is published to RabbitMQ (without waiting for it), and the response is cached under the idempotency key. |
| Any other value (e.g. `4000`, or blank) | `400 PAYMENT_FAILED` | No order is saved. The Order Service runs the compensating transaction: it calls the Catalog Service's rollback endpoint (up to 3 attempts, 100 ms then 200 ms apart), which restores the reserved quantity. The rollback is idempotent: a compensation record means a repeated rollback can't add stock twice. |

```
[Checkout] ---> [Idempotency key: PROCESSING] ---> [Valkey lock acquired]
                                                          |
                                                          v
                                           [Reserve stock (atomic decrement)]
                                                          |
                                     Payment check (4242 vs anything else)
                                        |                              |
                              (Success: save order,          (Failure: compensate)
                               commit reservation)                     |
                                        |                              v
                                        v                [Rollback: restore reserved qty]
                           [Publish 'OrderPlaced']
                                        \______________________________/
                                                       |
                                              [Lock released (finally)]
```

### 3.5 Journey 5: Event-Driven Notifications
* **Events:** The Notification Service consumes three events from a RabbitMQ topic exchange through a durable queue:
  * `OrderPlaced`, from checkout
  * `OrderDelivered`, from a Club Admin marking an order delivered
  * `delivery.slot.updated`, from a Club Admin setting a delivery slot
* **Observer + Strategy:** Each event goes to a broadcaster (Observer Pattern), which fans it out to every registered delivery strategy (Strategy Pattern). Today there is one strategy, `InAppNotificationStrategy`. It writes the notification to PostgreSQL and retries a failed write up to 3 times. New channels (email, WhatsApp) can be added as further strategies without changing the broadcaster.
* **Delivery-slot fan-out:** For a slot update, the Notification Service asks the Order Service which users ordered that item, and notifies each of them.
* **Viewing:** Students see their notifications on a Notifications page, which polls for updates, and can mark them as read.
* **Decoupling:** Checkout never waits on RabbitMQ or the Notification Service, so a slow or failed notification can't fail or delay an order that has already been saved.
* **Not built:** external channels (email/SMS/WhatsApp), and therefore no circuit breaker around them; real-time push (WebSockets/SSE).

### 3.6 Journey 6: Club Order Management
* **Club orders:** A Club Admin sees their own club's orders, with the student's email, item name, size, quantity, and status. A Super Admin views any club's orders by naming the club.
* **Mark delivered:** A Club Admin marks one of their club's orders `DELIVERED`. Orders from other clubs are rejected with `403`. This publishes `OrderDelivered`, which notifies the student. `DELIVERED` is the only status an admin can set; order cancellation is not supported.
* **Student order history:** Students see a list of their own orders and the detail of any single order of theirs.

### 3.7 Journey 7: Super Admin Administration
* **Look up a user by email:** an exact-match lookup returning name, role, and club. It is not a searchable directory.
* **Promote to Club Admin:** promotes a user to `CLUB_ADMIN` for an existing club. A user who already belongs to a club must be demoted first.
* **Create a club with its admin:** creates the club and assigns its Club Admin by email in one database transaction; if either step fails, neither is saved. A Super Admin can't be made a club's admin, and neither can a user who already belongs to a club.

---

## 4. Success Metrics (pending measurement)

No metrics are stated yet. Earlier versions of this document listed numeric targets and some informal measurements. None of them came from a proper measurement, so all of them were removed. This section will be filled in, with method and environment, once the metrics have been measured.

What will be measured:
* **Overselling under concurrency:** final stock and committed order count after a burst of concurrent checkouts on a limited item.
* **Lock latency:** time to acquire and release the per-item Valkey lock under contention.
* **Saga rollback:** success rate and latency of compensation after payment failures.
* **Catalog cache:** hit ratio, still to be measured.
  * Hit vs. miss latency for the first feed page has been measured: ≈207 ms for a hit vs. ≈336 ms for a miss, averaged over 3 rounds from a local machine against the managed cloud services.
  * The cross-region network round-trip dominates both numbers. See `learnings.md` #4 and `docs/system-design/LLD/caching/catalog-feed-cache.md`.
* **Notification decoupling:** checkout latency with the Notification Service healthy vs. unavailable.

---

## 5. Scope & System Boundaries

### 5.1 Built
* **Services:** a Node.js/Express API Gateway (JWT verification, role checks, rate limiting) in front of the User, Catalog, Order, and Notification services.
* **Data stores:**
  * PostgreSQL for users, clubs, orders, and notifications
  * MongoDB for catalog items, reservations, and compensation records
  * Valkey for the feed cache, checkout locks, idempotency keys, and rate limits
  * RabbitMQ for events

  All four are managed cloud services (Neon, MongoDB Atlas, Upstash, CloudAMQP).
* **Running locally:** `npm run dev` starts all five backend services (npm workspaces + `concurrently`). Alternatively, `docker compose up --build` runs all five plus the frontend (served by nginx) from their own `Dockerfile`s. Both modes use the same managed data stores.
* **Deployment:** a Render blueprint (`render.yaml`) on the free tier. Every backend service has its own public URL, and services trust only callers that present the shared internal service key.
* **Concurrency & resilience:**
  * per-item Valkey lock
  * atomic conditional stock decrement
  * checkout idempotency
  * saga compensation with bounded retries
  * PostgreSQL connection pools (`pg` `Pool`)
* **Design patterns:** Builder (student profile), Factory (catalog items), Command (`OrderCommand` for checkout), Observer (notification broadcaster), Strategy (notification channels).
* **Frontend:** a React + React Router single-page app styled with Tailwind, with 12 pages across the three roles. It is role-gated in the browser, and the gateway enforces the same checks server-side regardless. Notifications and stock counts refresh by polling.

### 5.2 Not Built (out of scope)
* Circuit breaker or retry pattern for external notification channels; no external channel exists.
* Email, SMS, or WhatsApp notifications.
* WebSockets/SSE real-time push.
* A real payment gateway (mock card values only).
* Editing or deleting items, deleting clubs, and cancelling orders.
* Per-size stock.
* A searchable user directory, or any infrastructure diagnostics panel.
* Load testing and measured metrics. These are pending (Section 4).
