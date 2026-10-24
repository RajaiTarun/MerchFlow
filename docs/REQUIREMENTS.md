# Requirements Specification: Centralized College Merchandise Management System

**Document Version:** 2.0  
**Status:** Describes the implemented system  
**Architecture:** Microservices with Polyglot Persistence & Event-Driven Communication  
**Primary Domain:** E-Commerce / Educational Technology  

**Revision note (2026-10-24):** rewritten so every requirement matches what was built.
- **Removed (never implemented):**
  - the circuit breaker requirement
  - exponential-backoff retries on all inter-service calls
  - PostgreSQL row-level locking
  - the Repository Pattern
  - Command objects for cancelling orders or updating slots
  - item editing
  - real-time push
  - the sprint timeline
- **Corrected:**
  - where requirements are enforced (e.g. idempotency lives in the Order Service, not the gateway)
  - the payment status codes
  - the catalog attribute model
- **Added:** order history, club order management, delivery slots, and notification read state.
- **Numbers:** no performance numbers appear here. Metrics are pending measurement; see the PRD, Section 4.

---

## 1. Executive Summary & Problem Statement

College clubs sell merchandise in silos, each with its own forms and size charts. Students re-enter the same details for every club, deal with inconsistent sizing, and have no single place to see what's available. Club managers have no structured way to showcase items or manage orders.

The **Centralized College Merchandise Management System** is a single portal that solves this. It also serves as a backend system design showcase: decoupled microservices, polyglot databases, distributed concurrency control, and compensating transactions, instead of a monolithic MERN setup.

---

## 2. Stakeholders & User Personas

- **The Student:** browses all club merchandise in one place, saves a size profile once, places orders, and follows their orders and notifications.
- **The Club Administrator:** publishes merchandise for their own club, schedules delivery slots, views their club's orders, and marks them delivered. Can also place orders.
- **The System Administrator (Super Admin):** has platform-wide permissions. Looks up any registered user by email, promotes a user to `CLUB_ADMIN`, and creates new clubs while assigning each club's admin in the same action. Can do anything a Club Admin can, for any club (naming the club explicitly), and can place orders.

---

## 3. Functional Requirements (FRs)

### FR1: User & Authentication Service
* **FR1.1 — Domain-Restricted Registration:** Registration accepts only emails matching `^[a-zA-Z0-9._%+-]+@students\.iiit\.ac\.in$`. Any other address is rejected with `403`; a duplicate email is rejected with `409`.
* **FR1.2 — Authentication:** Users log in with email and password. Passwords are stored as bcrypt hashes. On login the User Service issues a signed JWT with a 1-hour expiry, carrying the user id, email, role, and club id. The API Gateway verifies the JWT on every protected route.
* **FR1.3 — Saved Profile:** An authenticated user can save and update a profile: full name, phone, hostel block, and preferred size (`S`, `M`, `L`, `XL`, `XXL`). They can update the size on its own. A user can read and update only their own profile; their identity always comes from the verified JWT, never from the request.
* **FR1.4 — Role-Based Access Control:** Three roles are enforced: `STUDENT`, `CLUB_ADMIN` (scoped to one club), and `SUPER_ADMIN`. Permissions per endpoint are listed in `SECURITY_AND_ACCESS.md`.
* **FR1.5 — Builder Pattern:** Student profiles are assembled step by step with a Builder (`StudentProfileBuilder`).

### FR2: Merchandise Catalog Service
* **FR2.1 — Merchandise Publishing:** A Club Admin can publish items for their own club. A Super Admin can publish for any club by naming it, and the club is validated against the clubs table. Items can't be edited or deleted after publishing, except for their delivery slot (FR2.5).
* **FR2.2 — Type-Specific Attributes:** Every item has a name, description, price, stock, club, and type. Size support depends on the type:
  * `APPAREL` must list at least one available size.
  * `ACCESSORY` may list sizes.
  * `MUG` has none.

  Items are stored as MongoDB documents, so each type can carry its own fields without a relational EAV schema.
* **FR2.3 — Unified Browsing Feed:** Authenticated users can browse items from all clubs in one feed. It is ordered newest-first, uses cursor-based pagination, and can be filtered by type and club.
* **FR2.4 — Factory Pattern:** Items are instantiated through one factory (`MerchandiseFactory`), which returns the matching `Apparel`, `Mug`, or `Accessory` object and validates it.
* **FR2.5 — Delivery Slots:** A Club Admin can set a delivery date and time window on their own club's items; a Super Admin can do this for any item. Each update notifies the students who ordered that item (FR4.1).

### FR3: Order & Checkout Service
* **FR3.1 — Automatic Size Selection with Fallback:** At checkout, the Order Service fetches the student's saved preferred size and the item's available sizes.
  * If the item has no sizes, the order carries no size.
  * If the preferred size is offered, it is applied automatically.
  * If it isn't offered, or no preferred size is saved, checkout stops with `400` and returns the available sizes. The frontend lets the student pick one and resubmit; a picked size that isn't offered is rejected.
  * Sizes are offered per item. Stock is a single counter per item.
* **FR3.2 — Checkout Idempotency:** Checkout requires an `Idempotency-Key` header. The Order Service guarantees that duplicate submissions produce at most one order:
  * a retry after success returns the original response;
  * a duplicate sent while the first is in progress is rejected with `409`;
  * a failed checkout clears the key so it can be retried.
* **FR3.3 — Command Pattern:** A checkout is encapsulated as a single `OrderCommand` object. It validates its own fields and carries everything needed to create the order.
* **FR3.4 — Simulated Payment (Magic Values):** A mock card number decides the outcome deterministically:

| Mock Card Input | Result | Expected Backend Action |
| :--- | :--- | :--- |
| `4242` | `201 Created` | Save the order with status `COMMITTED`, commit the stock reservation, and publish `OrderPlaced`. |
| Any other value (e.g. `4000`, or blank) | `400 PAYMENT_FAILED` | Save no order, run the compensating rollback of the reserved stock, and release the inventory lock. |

* **FR3.5 — Order History:** A student can list their own orders and view the detail of any single order of theirs, and no one else's.
* **FR3.6 — Club Order Management:** A Club Admin can list their own club's orders, including the student's email, item name, size, quantity, and status. They can mark one of those orders `DELIVERED`, which notifies the student. A Super Admin can do both for any club. `DELIVERED` is the only status an admin can set; order cancellation is not supported.

### FR4: Notification Service
* **FR4.1 — Asynchronous In-App Notifications:** Notifications are generated asynchronously from events:
  * an order is placed
  * an order is marked delivered
  * a delivery slot is set or changed on an item; every student who ordered that item is notified
* **FR4.2 — Observer Pattern:** Incoming events go to a broadcaster, which notifies every registered delivery strategy without knowing how each one delivers.
* **FR4.3 — Strategy Pattern for Channels:** Each delivery channel implements `NotificationStrategy`. The system ships with `InAppNotificationStrategy` only. Future channels (email, WhatsApp) are added as new strategies without changing existing code.
* **FR4.4 — Viewing and Read State:** A user can list their own notifications and mark them as read. The frontend refreshes the list by polling; there is no real-time push.

### FR5: Super Admin Administration
Application-level administration only. There is no infrastructure diagnostics capability (service health aggregation, connection-pool or queue monitoring).

* **FR5.1 — User Lookup by Email:** The Super Admin can find an existing user by exact email and see their basic, non-sensitive details (name, current role, current club). This is an exact-match lookup, not a searchable or paginated directory.
* **FR5.2 — Role Promotion to Club Admin:** The Super Admin can promote an existing user to `CLUB_ADMIN` for an existing club. A user already assigned to a club must be demoted before being promoted to administer a different one.
* **FR5.3 — Club Creation with Admin Assignment:** The Super Admin can create a club and name its Club Admin by email in the same request.
  * Creation and assignment happen in one transaction: if either step fails, neither is saved.
  * A Super Admin can't be assigned as a club's admin, and neither can a user who already belongs to a club.

---

## 4. Non-Functional Requirements (NFRs)

### NFR1: Concurrency & Data Integrity
* **NFR1.1 — No Overselling:** Stock must never be oversold, even when many students check out the same limited item at once. The mechanism is in place (NFR1.2, NFR1.3). Verifying it under real concurrent load is pending, along with the other metrics.
* **NFR1.2 — Distributed Locking:** Each checkout takes a per-item lock in Valkey before touching stock.
  * The lock has an expiry, so a crashed request can't hold it forever.
  * It is released only by its owner (a token check inside a Lua script), in a `finally` block.
  * A checkout that can't get the lock is rejected with `409` instead of waiting.
* **NFR1.3 — Atomic Stock Decrement:** Stock is reserved with a single conditional update in MongoDB that succeeds only while stock covers the requested quantity. Insufficient stock is rejected with `409`.
* **NFR1.4 — Transactions:**
  * Stock reservations, rollbacks, and their bookkeeping records run in MongoDB transactions.
  * Club creation with admin assignment runs in a PostgreSQL transaction.
  * Orders are written to PostgreSQL only after payment succeeds.

### NFR2: Distributed System Resilience
* **NFR2.1 — Saga Compensation:** If stock is reserved but payment fails, the Order Service automatically runs a compensating transaction that restores the reserved quantity. The rollback is idempotent: a compensation record prevents stock from being restored twice.
* **NFR2.2 — Bounded Retries:** Two operations retry with a short linear backoff (3 attempts, 100 ms then 200 ms):
  * the compensation call from the Order Service to the Catalog Service;
  * the in-app notification write to PostgreSQL.

  There is no general retry layer for other inter-service calls, and no circuit breaker.
* **NFR2.3 — Health Endpoints:** The API Gateway and all four backend services expose `/health`. The backend endpoints sit behind the internal service key, like every other backend route.

### NFR3: Performance & Scalability
* **NFR3.1 — Catalog Caching:** The unfiltered first page of the catalog feed is cached in Valkey with a short expiry. It is invalidated whenever an item is created, a delivery slot changes, or stock changes. If Valkey is unavailable, the feed falls back to MongoDB.
* **NFR3.2 — Cursor-Based Pagination:** The catalog feed uses cursor-based pagination, not offset pagination.
* **NFR3.3 — Connection Pooling:** Every service that talks to PostgreSQL uses a connection pool (the `pg` library's `Pool`).
* **NFR3.4 — Asynchronous Event Decoupling:** Notifications are triggered through a RabbitMQ topic exchange (publish–subscribe). Publishing is fire-and-forget, so checkout never waits on the broker or the Notification Service.

### NFR4: Maintainability & Architecture
* **NFR4.1 — Microservices Modularity:** The application is split into independently deployable services by business domain: API Gateway, User Service, Catalog Service, Order Service, and Notification Service. Each has its own `Dockerfile`.
* **NFR4.2 — Polyglot Persistence:**
  * **PostgreSQL:** users, clubs, orders, and notifications, for relational integrity and transactions. All services that use PostgreSQL share one managed instance.
  * **MongoDB:** catalog items, stock reservations, and compensation records, for flexible per-type documents.
* **NFR4.3 — Design Patterns:** Builder (profiles), Factory (catalog items), Command (checkout), Observer (notification broadcaster), and Strategy (notification channels).

### NFR5: Security
* **NFR5.1:** Authentication, authorization, rate limiting, service-to-service trust, and known gaps are specified in `SECURITY_AND_ACCESS.md`.

---

## 5. Scope & System Boundaries

### Built
* The five services above, plus a React single-page frontend with 12 pages across the three roles.
* Managed cloud data stores: PostgreSQL (Neon), MongoDB Atlas, Valkey (Upstash), and RabbitMQ (CloudAMQP).
* Two ways to run locally: `npm run dev` (all backend services via npm workspaces and `concurrently`), or `docker compose up --build` (all services plus the frontend). Both use the same managed data stores.
* Deployment on Render's free tier from a single `render.yaml` blueprint.

### Not built (out of scope)
* Circuit breaker or general retry layer; external notification channels (email, SMS, WhatsApp).
* Real-time push (WebSockets/SSE).
* A real payment gateway.
* Editing or deleting items, deleting clubs, and cancelling orders.
* Per-size stock.
* A searchable user directory, or infrastructure diagnostics.
* Load testing and measured metrics (pending).
