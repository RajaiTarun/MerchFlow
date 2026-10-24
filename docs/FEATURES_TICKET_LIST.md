# Feature Ticket List (As Delivered)

**Project:** Centralized College Merchandise Management System

**Document Version:** 2.0

**Status:** Records the tickets as they were actually delivered

**Revision note (2026-10-24):** rewritten from the original sprint backlog to match the built system.
- **Removed:**
  - `NTF-503` (Opossum circuit breaker), which was never built and has no external channel to protect
  - the telemetry-drawer and badge UI acceptance criteria
  - `express-mongo-sanitize`
  - the Repository Pattern
  - per-size stock
  - the sprint timeline and hour estimates
  - every latency or load-test figure. Metrics are pending measurement; see `PRD.md` §4.
- **Corrected:** the acceptance criteria now match the code.
- **Added:** tickets for features that shipped but weren't in the original backlog (delivery slots, club order management, order history, notification read state, Render deployment, free-tier wake-up handling).

Every acceptance criterion below is checked against the current code.

---

## 🛠️ Infrastructure & API Gateway

### Ticket `INF-101`: Multi-Process Workspace & Cloud Data Stores

* **Module:** Core Infrastructure
* **Priority:** 🔴 Critical (P0)
* **Description:** Root npm workspace that runs all five backend services with `concurrently`, connected to managed cloud data stores: Neon PostgreSQL, MongoDB Atlas, Upstash Valkey, and CloudAMQP RabbitMQ.
* **Design Patterns & Tactics:** Connection Pooling (`pg` `Pool`), environment-based configuration (repo-root `.env`).
* **Acceptance Criteria (AC):**
* [x] `npm run dev` from the repo root starts all five services.
* [x] PostgreSQL connections use TLS when `DATABASE_URL` has `sslmode=require`.
* [x] Every service exposes `/health` reporting its database connectivity.

---

### Ticket `GW-102`: API Gateway Routing & Inter-Service Key

* **Module:** API Gateway (port 3000)
* **Priority:** 🔴 Critical (P0)
* **Description:** An Express gateway that is the frontend's single entry point. It proxies `/api/v1/users`, `/api/v1/clubs`, `/api/v1/catalog`, `/api/v1/orders` and `/api/v1/notifications` to the User (3001), Catalog (3002), Order (3003) and Notification (3004) services.
* **Design Patterns & Tactics:** API Gateway Pattern, internal service key (`X-Internal-Service-Key`).
* **Acceptance Criteria (AC):**
* [x] Each `/api/v1/*` prefix proxies to its service.
* [x] The gateway adds `X-Internal-Service-Key` to every proxied request, and services add it to their direct calls to each other.
* [x] Every backend service rejects requests without the key with `403 Forbidden`.
* [x] Proxy failures are logged with the target service and answered with `502`.

---

### Ticket `GW-103`: Valkey Rate Limiting

* **Module:** API Gateway (port 3000)
* **Priority:** 🟡 High (P1)
* **Description:** Rate limiting at the gateway, backed by Valkey, for the catalog and order routes.
* **Design Patterns & Tactics:** Atomic Lua script (counter with a guaranteed expiry, called a token bucket in the code), Middleware Pattern.
* **Acceptance Criteria (AC):**
* [x] Requests under `/api/v1/catalog` and `/api/v1/orders` are counted per route group per IP.
* [x] Exceeding the limit returns `429` with error `RATE_LIMITED` and a `Retry-After` header.
* [x] Every path through the Lua script leaves the key with an expiry, so a bucket can't get stuck permanently (`learnings.md` #9).
* [x] Limits are configured in `rateLimiter.js`; they are currently set to 1000 requests per 60 s for each route group.

---

## 🔐 User & Auth Service

### Ticket `USR-201`: Domain-Restricted Registration & bcrypt Hashing

* **Module:** User Service (port 3001 / PostgreSQL)
* **Priority:** 🔴 Critical (P0)
* **Acceptance Criteria (AC):**
* [x] Registration emails must match `^[a-zA-Z0-9._%+-]+@students\.iiit\.ac\.in$`; any other domain returns `403` before the database is queried.
* [x] Duplicate emails return `409`.
* [x] Passwords are hashed with bcrypt (salt rounds = 12) before insertion, using parameterized queries.

---

### Ticket `USR-202`: Builder Pattern Student Profile & Saved Size

* **Module:** User Service (port 3001 / PostgreSQL)
* **Priority:** 🟡 High (P1)
* **Design Patterns & Tactics:** Builder Pattern.
* **Acceptance Criteria (AC):**
* [x] `StudentProfileBuilder` assembles name, phone, hostel block, and preferred size.
* [x] `PUT /api/v1/users/profile` (partial update) and `PUT /api/v1/users/size` save the profile; sizes are limited to `S`, `M`, `L`, `XL`, `XXL`.
* [x] `GET /api/v1/users/profile/:userId` returns only the caller's own profile; the identity comes from the JWT through the gateway-set `x-user-id` (`learnings.md` #3).

---

### Ticket `USR-203`: JWT Issuance & Role-Based Access Control

* **Module:** User Service (port 3001) & API Gateway
* **Priority:** 🔴 Critical (P0)
* **Design Patterns & Tactics:** Stateless sessions, RBAC, club scoping.
* **Acceptance Criteria (AC):**
* [x] Login issues a JWT with `sub`, `email`, `role` and `clubId`, valid for 1 hour.
* [x] The gateway verifies the JWT and returns `401` for a missing, invalid, or expired token.
* [x] A `STUDENT` calling `POST /api/v1/catalog` gets `403`.
* [x] A Club Admin acting on another club's item or order gets `403`; the service checks this using the gateway-set `x-club-id`.
* [x] A `SUPER_ADMIN` passes every role check and can act on any club by naming it.

---

### Ticket `USR-204`: Super Admin Email Lookup, Role Promotion & Club Creation

* **Module:** User Service (port 3001) & API Gateway
* **Priority:** 🟡 High (P1)
* **Design Patterns & Tactics:** Exact-match lookup (no directory or search), database transaction.
* **Acceptance Criteria (AC):**
* [x] `GET /api/v1/users/lookup?email=` (`SUPER_ADMIN`) returns `{id, email, full_name, role, club_id}` for an exact match, or `404`. It never returns `password_hash`.
* [x] `PUT /api/v1/users/:userId/role` (`SUPER_ADMIN`) rejects promotion with `400` if the target already has a `club_id`.
* [x] `POST /api/v1/clubs` (`SUPER_ADMIN`) takes `{name, description?, admin_email}` and creates the club and assigns its admin in one transaction.
* [x] `POST /api/v1/clubs` returns `404` for an unknown `admin_email`, `400` if that user is a `SUPER_ADMIN` or already has a club, and `409` for a duplicate club name.

---

## 📦 Catalog Service

### Ticket `CAT-301`: MongoDB Catalog & Factory Pattern

* **Module:** Catalog Service (port 3002 / MongoDB)
* **Priority:** 🟡 High (P1)
* **Design Patterns & Tactics:** Factory Pattern, document persistence.
* **Acceptance Criteria (AC):**
* [x] `MerchandiseFactory.createItem(type, payload)` returns an `Apparel`, `Mug`, or `Accessory` object, and rejects unknown types.
* [x] `POST /api/v1/catalog` publishes an item with name, description, price, stock, and type. Apparel must list at least one available size, accessories may list sizes, and mugs have none.
* [x] A Club Admin's item is always assigned to their own club. A Super Admin must name the club, which is validated against PostgreSQL.

---

### Ticket `CAT-302`: Cursor Pagination & Valkey Page-1 Cache

* **Module:** Catalog Service (port 3002 / Valkey)
* **Priority:** 🟡 High (P1)
* **Design Patterns & Tactics:** Cache-Aside, cursor-based pagination.
* **Acceptance Criteria (AC):**
* [x] `GET /api/v1/catalog` accepts `?cursor=`, `?type=` and `?clubId=`, and returns items newest-first with a `nextCursor`.
* [x] Only the unfiltered first page uses the cache key `catalog:feed:page:1` (60-second TTL). Filtered requests always query MongoDB (`learnings.md` #1).
* [x] Creating an item, changing a delivery slot, reserving stock, and rolling back stock all invalidate the cache (`learnings.md` #5).
* [x] If Valkey is down, the feed falls back to MongoDB.

---

### Ticket `CAT-303`: Delivery Slots

* **Module:** Catalog Service (port 3002) & RabbitMQ
* **Priority:** 🟡 High (P1)
* **Acceptance Criteria (AC):**
* [x] `PUT /api/v1/catalog/:id/delivery-slot` sets `{date, startTime, endTime}` on an item. It is open to Club Admins (own club's items) and Super Admins.
* [x] A successful update publishes `delivery.slot.updated` to the `order.events` exchange without waiting for it.

---

## ⚡ Order Service & Concurrency

### Ticket `ORD-401`: Automatic Size Selection & Fallback

* **Module:** Order Service (port 3003)
* **Priority:** 🔴 Critical (P0)
* **Design Patterns & Tactics:** Command Pattern (`OrderCommand`), inter-service calls.
* **Acceptance Criteria (AC):**
* [x] Checkout fetches the student's profile from the User Service and the item from the Catalog Service, both with the internal key.
* [x] If the item has sizes and no size is chosen, the saved preferred size is used when the item offers it.
* [x] If the preferred size isn't offered, or none is saved, checkout returns `400` with `PREFERRED_SIZE_UNAVAILABLE` or `NO_PREFERRED_SIZE` plus `availableSizes`. A chosen size that isn't offered returns `SELECTED_SIZE_UNAVAILABLE`.
* [x] The checkout is assembled as an `OrderCommand`, which validates its own fields.

---

### Ticket `ORD-402`: Checkout Idempotency via Valkey

* **Module:** Order Service (port 3003 / Valkey)
* **Priority:** 🔴 Critical (P0)
* **Design Patterns & Tactics:** Idempotency Key Pattern.
* **Acceptance Criteria (AC):**
* [x] Checkout requires an `Idempotency-Key` header; without it the request returns `400`.
* [x] The key is claimed in Valkey as `idempotency:order:{key}` = `PROCESSING` with `SET NX` and a 24-hour TTL.
* [x] A repeat after `SUCCESS` returns the cached response, and a repeat while the first is still `PROCESSING` returns `409`.
* [x] A failed checkout clears the key so it can be retried. If Valkey is unavailable, checkout returns `503`.

---

### Ticket `ORD-403`: Valkey Distributed Lock & Atomic Stock Reservation

* **Module:** Order Service (port 3003) & Catalog Service
* **Priority:** 🔴 Critical (P0)
* **Design Patterns & Tactics:** Distributed lock (`SET NX PX` with an owner token), atomic conditional update.
* **Acceptance Criteria (AC):**
* [x] Checkout runs `SET lock:item:{id} <random token> NX PX 15000`.
* [x] If the lock is held, checkout returns `409 LOCK_CONTENTION_DETECTED` with `Retry-After: 1`.
* [x] Stock is reserved by an atomic `findOneAndUpdate` that requires `stock >= quantity`, and the reservation is recorded in the same MongoDB transaction. Insufficient stock returns `409 OUT_OF_STOCK`.
* [x] The lock is released in `finally`, by a Lua script that deletes it only if the token matches.
* [ ] Load test of concurrent checkouts against limited stock. Pending; see `PRD.md` §4.

---

### Ticket `ORD-404`: Mock Payment & Saga Compensation

* **Module:** Order Service & Catalog Service
* **Priority:** 🔴 Critical (P0)
* **Design Patterns & Tactics:** Saga Pattern with a compensating transaction.
* **Acceptance Criteria (AC):**
* [x] With `mockCardNumber == "4242"`, the order is saved to PostgreSQL as `COMMITTED`, the reservation is committed in the Catalog Service, `OrderPlaced` is published, and the response is `201`.
* [x] With any other value, the response is `400 PAYMENT_FAILED` and no order is saved.
* [x] On failure, the Order Service calls the Catalog Service's `PATCH /:id/rollback` (up to 3 attempts, 100 ms and 200 ms apart), which restores the reserved quantity.
* [x] The rollback is idempotent: an `InventoryCompensation` record prevents restoring stock twice.

---

### Ticket `ORD-405`: Order History & Club Order Management

* **Module:** Order Service (port 3003)
* **Priority:** 🟡 High (P1)
* **Acceptance Criteria (AC):**
* [x] `GET /api/v1/orders` lists the caller's own orders, and `GET /api/v1/orders/:id` returns only the caller's own order (`403` otherwise).
* [x] `GET /api/v1/orders/club` lists a club's orders with student email and item name. Club Admins see their own club; Super Admins pass `?clubId=`.
* [x] `PATCH /api/v1/orders/:orderId/status` accepts only `DELIVERED`. It is open to Club Admins (own club, `403` otherwise) and Super Admins, and publishes `OrderDelivered`.

---

## 📢 Notification Service

### Ticket `NTF-501`: RabbitMQ Events & Decoupling

* **Module:** Order Service, Catalog Service & Notification Service
* **Priority:** 🟡 High (P1)
* **Design Patterns & Tactics:** Publish–Subscribe.
* **Acceptance Criteria (AC):**
* [x] Events go to the durable topic exchange `order.events`: `OrderPlaced` (`order.placed`), `OrderDelivered` (`order.delivered`) and `delivery.slot.updated`.
* [x] Publishing is fire-and-forget, so checkout responds without waiting for the broker.
* [x] The Notification Service consumes all three routing keys from a durable queue.

---

### Ticket `NTF-502`: Strategy & Observer Notification Dispatch

* **Module:** Notification Service (port 3004)
* **Priority:** 🟡 High (P1)
* **Design Patterns & Tactics:** Strategy Pattern (`NotificationStrategy`), Observer Pattern (`NotificationBroadcaster`), Open/Closed Principle.
* **Acceptance Criteria (AC):**
* [x] The broadcaster fans each event out to every registered strategy.
* [x] `InAppNotificationStrategy` writes to the PostgreSQL `notifications` table and retries a failed write up to 3 times.
* [x] For `delivery.slot.updated`, the service fetches the item's buyers from the Order Service and notifies each of them.
* [x] A new channel (email, WhatsApp) can be added as another strategy without changing the consumer.

---

### Ticket `NTF-503`: Notification Feed & Read State

* **Module:** Notification Service (port 3004)
* **Priority:** 🟢 Medium (P2)
* **Acceptance Criteria (AC):**
* [x] `GET /api/v1/notifications` returns the caller's own notifications, newest first.
* [x] `PATCH /api/v1/notifications/:id/read` marks one as read. Ownership is part of the `WHERE` clause, so another user's notification returns `404`.

*(The original `NTF-503`, an Opossum circuit breaker, was dropped and never built. Its ID is reused here.)*

---

## 🖥️ Frontend

### Ticket `UI-601`: React Bootstrap, Session & API Client

* **Module:** Frontend (React 19 / Vite / Tailwind 4)
* **Priority:** 🟡 High (P1)
* **Acceptance Criteria (AC):**
* [x] `AuthContext` keeps the JWT in `localStorage` and discards it on load if it has expired.
* [x] `apiFetch` attaches `Authorization: Bearer <jwt>` and exposes backend error codes and `Retry-After` to callers.
* [x] Routes are role-gated with `ProtectedRoute`, and the gateway enforces the same rules regardless.

---

### Ticket `UI-602`: Catalog, Item Detail & Size Fallback

* **Module:** Frontend
* **Priority:** 🟡 High (P1)
* **Acceptance Criteria (AC):**
* [x] The catalog feed has type and club filters and a "Load More" button driven by `nextCursor`.
* [x] Item detail polls stock while open.
* [x] Item detail pre-selects the preferred size when the item offers it, and otherwise requires the student to pick an available size.

---

### Ticket `UI-603`: Checkout State Machine & Retry Contract

* **Module:** Frontend
* **Priority:** 🔴 Critical (P0)
* **Acceptance Criteria (AC):**
* [x] One `Idempotency-Key` is generated per checkout attempt and reused on every retry.
* [x] The button is disabled while placing or retrying.
* [x] `LOCK_CONTENTION_DETECTED` and `RATE_LIMITED` are retried after `Retry-After` plus random jitter, up to 3 attempts in total.
* [x] `OUT_OF_STOCK`, `PAYMENT_FAILED` (with a "saga rollback restored the reserved stock" message), and other errors end the attempt with plain-text feedback.

---

### Ticket `UI-604`: Admin Pages

* **Module:** Frontend (`/admin/*`)
* **Priority:** 🟢 Medium (P2)
* **Acceptance Criteria (AC):**
* [x] Club Admin + Super Admin pages:
  * create item;
  * delivery slots;
  * club orders, with "Mark delivered".

  A Super Admin picks the club with `ClubPicker`.
* [x] Super Admin pages:
  * look up a user by email and promote them, saying so up front if the user already has a club;
  * create a club with its admin.
* [x] There are no service-health, queue, or circuit-breaker views.

---

### Ticket `UI-605`: Profile, Orders & Notifications Pages

* **Module:** Frontend
* **Priority:** 🟡 High (P1)
* **Acceptance Criteria (AC):**
* [x] The profile page edits name, phone, hostel block, and preferred size.
* [x] The orders page lists the student's own orders.
* [x] The notifications page polls for new notifications and can mark them read.

---

## 🐳 Containers & Deployment

### Ticket `DEV-701`: Dockerfiles & Root Docker Compose

* **Module:** Containers
* **Priority:** 🟡 High (P1)
* **Acceptance Criteria (AC):**
* [x] Each of the five services and the frontend has its own `Dockerfile`; the frontend is served by nginx.
* [x] `docker compose up --build` runs all six containers on Compose's default network, with only the gateway (3000) and the frontend (5173) published. They use the same managed cloud data stores as local dev.
* [x] Service URLs switch from `localhost` to Compose hostnames through environment variables (e.g. `http://user-service:3001`).

---

### Ticket `DEV-702`: Render Deployment & Free-Tier Wake-Up Handling

* **Module:** Deployment
* **Priority:** 🟡 High (P1)
* **Acceptance Criteria (AC):**
* [x] `render.yaml` deploys the five services (from their Dockerfiles) and the frontend (as a static site) on the free tier.
* [x] Services call each other over their public URLs, protected by the internal service key, because free web services can't receive private-network traffic.
* [x] On load, the frontend hits the gateway's `/warmup` endpoint.
* [x] `apiFetch` waits 30 s and retries (at most twice) replay-safe requests that fail while a service is waking, showing a `WakingBanner` meanwhile.

---

## 📊 Summary Matrix

| Ticket ID | Module | Priority | Delivered |
| --- | --- | --- | --- |
| **`INF-101`** | Infrastructure | 🔴 P0 | Workspace + managed cloud data stores + `/health` |
| **`GW-102`** | API Gateway | 🔴 P0 | Proxy routing + internal service key |
| **`GW-103`** | API Gateway | 🟡 P1 | Valkey rate limiting (`429` + `Retry-After`) |
| **`USR-201`** | User Service | 🔴 P0 | Domain-gated registration + bcrypt |
| **`USR-202`** | User Service | 🟡 P1 | Builder-pattern profile + saved size |
| **`USR-203`** | User Service / Gateway | 🔴 P0 | JWT (1 h) + RBAC with club scoping |
| **`USR-204`** | User Service | 🟡 P1 | Email lookup + promotion guard + transactional club creation |
| **`CAT-301`** | Catalog Service | 🟡 P1 | MongoDB catalog + Factory Pattern |
| **`CAT-302`** | Catalog Service | 🟡 P1 | Cursor pagination + page-1 Valkey cache |
| **`CAT-303`** | Catalog Service | 🟡 P1 | Delivery slots + `delivery.slot.updated` |
| **`ORD-401`** | Order Service | 🔴 P0 | Automatic size selection + fallback |
| **`ORD-402`** | Order Service | 🔴 P0 | Checkout idempotency |
| **`ORD-403`** | Order + Catalog | 🔴 P0 | Distributed lock + atomic stock reservation (load test pending) |
| **`ORD-404`** | Order + Catalog | 🔴 P0 | Mock payment + saga compensation |
| **`ORD-405`** | Order Service | 🟡 P1 | Order history + club order management |
| **`NTF-501`** | Messaging | 🟡 P1 | RabbitMQ events, fire-and-forget publishing |
| **`NTF-502`** | Notification Service | 🟡 P1 | Strategy + Observer dispatch, in-app channel |
| **`NTF-503`** | Notification Service | 🟢 P2 | Notification feed + read state |
| **`UI-601`** | Frontend | 🟡 P1 | Session + API client + role-gated routes |
| **`UI-602`** | Frontend | 🟡 P1 | Catalog + item detail + size fallback |
| **`UI-603`** | Frontend | 🔴 P0 | Checkout state machine + retry contract |
| **`UI-604`** | Frontend | 🟢 P2 | Admin pages |
| **`UI-605`** | Frontend | 🟡 P1 | Profile, orders, notifications pages |
| **`DEV-701`** | Containers | 🟡 P1 | Dockerfiles + root Docker Compose |
| **`DEV-702`** | Deployment | 🟡 P1 | Render blueprint + wake-up handling |
