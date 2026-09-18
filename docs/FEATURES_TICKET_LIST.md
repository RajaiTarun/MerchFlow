# Feature Ticket List: Engineering Sprint Backlog

**Project:** Centralized College Merchandise Management System

**Document Version:** 1.0

**Execution Strategy:** Phase 1 (Local Modular Ports + Serverless Cloud DBs) & Phase 2 (Docker Containerization)

**Sprint Timeline:** 8 Focused Coding Days (~54–62 Total Engineering Hours)

---

## 🛠️ Phase 1: Infrastructure & API Gateway Foundation (Days 1–2)

### Ticket `INF-101`: Multi-Process Workspace & Cloud Database Pooling

* **Module:** Core Infrastructure & DevOps
* **Priority:** 🔴 **Critical (P0 - Blocker)** * **Estimated Time:** 3 Hours
* **Description:** Establish the root orchestrator workspace using `concurrently` to run 5 independent microservice processes simultaneously. Configure connection drivers to connect securely over TLS/SSL (`sslmode=require`) to free serverless cloud tiers: **Neon PostgreSQL**, **MongoDB Atlas**, **Upstash Valkey/Redis**, and **CloudAMQP RabbitMQ**.
* **Design Patterns & Tactics:** Repository Pattern (Database Abstraction), Connection Pooling (`pg-pool` with `max: 10` connections), Environmental Abstraction (`.env`).
* **Acceptance Criteria (AC):**
* [ ] Running `npm run dev` from the project root boots all 5 services without terminal conflicts or memory crashes.
* [ ] PostgreSQL connection pool successfully establishes connections to Neon with SSL validation enabled.
* [ ] MongoDB Atlas, Upstash Valkey, and CloudAMQP connection handshakes log success confirmed via service console outputs.
* [ ] Each microservice exposes a functional `/health` endpoint returning database heartbeat status.



---

### Ticket `GW-102`: Express API Gateway Routing & Inter-Service Security

* **Module:** API Gateway (`Port 3000`)
* **Priority:** 🔴 **Critical (P0 - Blocker)** * **Estimated Time:** 4 Hours
* **Description:** Construct the Express.js API Gateway to serve as the sole public perimeter for web clients. Configure HTTP proxy routing to direct inbound traffic to internal microservices running on ports `3001` (User/Auth), `3002` (Catalog), and `3003` (Order).
* **Design Patterns & Tactics:** API Gateway Pattern, Zero-Trust Internal Header Injection (`X-Internal-Service-Key`).
* **Acceptance Criteria (AC):**
* [ ] Requests to `http://localhost:3000/api/v1/users/*` cleanly proxy to Port `3001`.
* [ ] Requests to `http://localhost:3000/api/v1/catalog/*` cleanly proxy to Port `3002`.
* [ ] Requests to `http://localhost:3000/api/v1/orders/*` cleanly proxy to Port `3003`.
* [ ] Inter-service calls attach `X-Internal-Service-Key`; downstream services reject requests lacking this header with HTTP `403 Forbidden`.



---

### Ticket `GW-103`: Valkey Token Bucket Rate Limiting & NoSQLi Sanitization

* **Module:** API Gateway (`Port 3000`)
* **Priority:** 🟡 **High (P1)** * **Estimated Time:** 4 Hours
* **Description:** Implement DDoS and abuse mitigation middleware at the gateway. Build an in-memory rate limiter using the Token Bucket algorithm backed by Upstash Valkey. Integrate request body sanitization to strip malicious NoSQL injection syntax.
* **Design Patterns & Tactics:** Token Bucket Algorithm, Decorator / Middleware Pattern, Parameterized Input Sanitization.
* **Acceptance Criteria (AC):**
* [ ] Catalog browsing (`GET /api/v1/catalog`) is throttled at **100 requests per minute** per IP address.
* [ ] Checkout initiation (`POST /api/v1/orders`) is throttled at **5 attempts per minute** per authenticated JWT.
* [ ] Breaching rate thresholds instantly returns HTTP `429 Too Many Requests` with a valid `Retry-After` header.
* [ ] `express-mongo-sanitize` middleware strips MongoDB operators (`$`, `.`) from all incoming JSON payloads.



---

## 🔐 Phase 2: User & Auth Service — Relational Domain (Days 2–3)

### Ticket `USR-201`: Domain-Restricted Registration & Bcrypt Credential Hashing

* **Module:** User & Auth Service (`Port 3001` / PostgreSQL)
* **Priority:** 🔴 **Critical (P0 - Blocker)** * **Estimated Time:** 4 Hours
* **Description:** Build student registration logic enforcing strict university domain gating via regex matching. Ensure user passwords are securely hashed using adaptive cryptographic work factors before saving to PostgreSQL.
* **Design Patterns & Tactics:** Parameterized Prepared Statements (SQLi Defense), Cryptographic Salt & Hashing.
* **Acceptance Criteria (AC):**
* [ ] Registration payloads are evaluated against `^[a-zA-Z0-9._%+-]+@students\.iiit\.ac\.in$`.
* [ ] Registration attempts using public domains (e.g., `@gmail.com`) fail fast with HTTP `403 Forbidden` before database evaluation.
* [ ] Plaintext passwords are hashed using **bcrypt** with `salt rounds = 12` prior to SQL insertion.



---

### Ticket `USR-202`: Builder Pattern Student Profile Construction & Saved Size

* **Module:** User & Auth Service (`Port 3001` / PostgreSQL)
* **Priority:** 🟡 **High (P1)** * **Estimated Time:** 4 Hours
* **Description:** Implement the profile management endpoint allowing students to save their contact details, campus address, and global sizing preferences. Construct complex profile payloads step-by-step using the Builder Pattern.
* **Design Patterns & Tactics:** Builder Pattern, Relational Schema Integrity.
* **Acceptance Criteria (AC):**
* [ ] Profile creation utilizes a `StudentProfileBuilder` class to assemble attributes (Name, Phone, Hostel Block, Preferred Size).
* [ ] Students can successfully update their preferred size (`S`, `M`, `L`, `XL`, `XXL`) via `PUT /api/v1/users/size`.
* [ ] Profile data persists cleanly in the PostgreSQL `users` table with Foreign Key constraints.



---

### Ticket `USR-203`: Stateless JWT Issuance & Tenant-Scoped RBAC Middleware

* **Module:** User & Auth Service (`Port 3001`) & API Gateway
* **Priority:** 🔴 **Critical (P0 - Blocker)** * **Estimated Time:** 4 Hours
* **Description:** Implement login verification and JWT token issuance. Construct authorization middleware at the API Gateway to enforce Role-Based Access Control (RBAC) across three operational tiers, including tenant isolation for Club Admins.
* **Design Patterns & Tactics:** Stateless Session Management, Role-Based Access Control (RBAC), Tenant Isolation.
* **Acceptance Criteria (AC):**
* [ ] Successful login issues a signed JWT containing claims: `sub` (User ID), `email`, `role`, and assigned `clubId` with a **1-hour TTL**.
* [ ] Standard Students (`role: STUDENT`) attempting to access `POST /api/v1/catalog` receive HTTP `403 Forbidden`.
* [ ] Club Admins attempting to modify merchandise belonging to a different `clubId` receive HTTP `403 Forbidden`.
* [ ] Super Admins (`role: SUPER_ADMIN`) successfully bypass tenant restrictions to manage system-wide resources.



---

### Ticket `USR-204`: Super Admin Email Lookup, Role Promotion & Club Creation

* **Module:** User & Auth Service (`Port 3001`) & API Gateway
* **Priority:** 🟡 **High (P1)** * **Estimated Time:** 3 Hours
* **Description:** Give the Super Admin the minimal backend surface needed to run the application-level admin panel (see `SECURITY_AND_ACCESS.md` §5) — finding a user by email, promoting a `STUDENT` to `CLUB_ADMIN`, and creating a new club with its admin assigned in one step. Explicitly **not** a user-directory/search feature and **not** infrastructure diagnostics — see `UI-604` below, which this replaces the diagnostics scope of.
* **Design Patterns & Tactics:** Exact-Match Lookup (no fuzzy search/pagination), Database Transaction (club creation + admin assignment), Reused `users.club_id → clubs.id` relationship (no new schema/relationship introduced).
* **Acceptance Criteria (AC):**
* [ ] `GET /api/v1/users/lookup?email=` (`SUPER_ADMIN` only) returns `{id, email, full_name, role, club_id}` for an exact email match, or `404` if none exists. No `password_hash` or other sensitive field is ever returned.
* [ ] `PUT /api/v1/users/:userId/role` (`SUPER_ADMIN` only, pre-existing) rejects promotion to `CLUB_ADMIN` with `400` if the target already has a non-null `club_id`.
* [ ] `POST /api/v1/clubs` (`SUPER_ADMIN` only) accepts `{name, description?, admin_email}`, creates the club and promotes/assigns `admin_email`'s user to `CLUB_ADMIN` for it — both in one database transaction, so a failure at either step leaves neither change committed.
* [ ] `POST /api/v1/clubs` returns `404` if `admin_email` doesn't match an existing user, `400` if that user is `SUPER_ADMIN` or already has a `club_id`, and `409` on a duplicate club name.
* [ ] None of the three endpoints above are reachable by `STUDENT` or `CLUB_ADMIN` roles (`403`).



---

## 📦 Phase 3: Merchandise Catalog Service — NoSQL Domain (Days 3–4)

### Ticket `CAT-301`: MongoDB Schema-less Catalog & Factory Pattern Instantiation

* **Module:** Merchandise Catalog Service (`Port 3002` / MongoDB)
* **Priority:** 🟡 **High (P1)** * **Estimated Time:** 4 Hours
* **Description:** Build the catalog CRUD endpoints using MongoDB Atlas. Leverage document schemas to store varying item attributes (apparel sizes vs. mug volumes) without EAV complexity. Instantiate distinct item objects in code using the Factory Pattern.
* **Design Patterns & Tactics:** Factory Pattern, Polyglot Document Persistence.
* **Acceptance Criteria (AC):**
* [ ] Implements a `MerchandiseFactory.createItem(type, payload)` method to instantiate `Apparel`, `Mug`, or `Accessory` domain objects.
* [ ] Club Admins can publish items (`POST /api/v1/catalog`) with dynamic attributes (e.g., `fabric_weight` for hoodies, `volume_ml` for mugs).
* [ ] Each catalog item initializes with an integer `stock` counter and an `availableSizes` array.



---

### Ticket `CAT-302`: Cursor-Based Pagination & Valkey Page-1 Feed Caching

* **Module:** Merchandise Catalog Service (`Port 3002` / Upstash Valkey)
* **Priority:** 🟡 **High (P1)** * **Estimated Time:** 4 Hours
* **Description:** Optimize unified catalog browsing (`GET /api/v1/catalog`) for high-traffic drops. Implement cursor-based pagination using document ObjectIDs to prevent offset degradation. Integrate Upstash Valkey to cache Page 1 feed results in memory.
* **Design Patterns & Tactics:** Cache-Aside Pattern, Cursor-Based Pagination.
* **Acceptance Criteria (AC):**
* [ ] Catalog feed queries accept a `?cursor={last_id}` parameter, returning paginated items and a `nextCursor` string.
* [ ] Requests for Page 1 evaluate Valkey cache key `catalog:feed:page:1` before querying MongoDB.
* [ ] Cache hits serve merchandise JSON directly from memory in **< 15ms**.
* [ ] Cache misses query MongoDB, return data to the client, and populate Valkey with a **60-second TTL**.



---

## ⚡ Phase 4: Order Service & Concurrency Engine — Heart of the System (Days 4–6)

### Ticket `ORD-401`: Automated Size Injection & Out-of-Stock Fallback Interception

* **Module:** Order & Checkout Service (`Port 3003` / PostgreSQL)
* **Priority:** 🔴 **Critical (P0 - Blocker)** * **Estimated Time:** 4 Hours
* **Description:** Build the checkout initiation flow (`POST /api/v1/orders`). Implement inter-service communication where Order Service fetches the student's saved size from User Service. If the saved size is out of stock, intercept checkout progression and mandate manual size selection.
* **Design Patterns & Tactics:** Command Pattern (Order Encapsulation), Inter-Service Communication.
* **Acceptance Criteria (AC):**
* [ ] Order Service calls User Service (`http://localhost:3001/api/v1/users/profile`) using `X-Internal-Service-Key` to retrieve `preferredSize`.
* [ ] If `preferredSize` (e.g., `L`) has stock `> 0` in the target catalog item, size `L` is auto-injected into the order command object.
* [ ] If size `L` has stock `== 0`, the backend rejects auto-checkout with HTTP `400 Bad Request` and structured payload: `{ error: "PREFERRED_SIZE_UNAVAILABLE", availableSizes: ["S", "M", "XL"] }`.



---

### Ticket `ORD-402`: Checkout Idempotency Verification via Valkey

* **Module:** Order & Checkout Service (`Port 3003` / Upstash Valkey)
* **Priority:** 🔴 **Critical (P0 - Blocker)** * **Estimated Time:** 4 Hours
* **Description:** Protect financial checkout transactions against network lag, double-clicks, and replay attacks by enforcing client-generated idempotency keys evaluated in Upstash Valkey.
* **Design Patterns & Tactics:** Idempotency Key Pattern, In-Memory Transaction Deduplication.
* **Acceptance Criteria (AC):**
* [ ] Checkout API mandates an `Idempotency-Key` UUID header; requests lacking it fail with HTTP `400 Bad Request`.
* [ ] Before processing, backend checks Valkey key `idempotency:order:{uuid}`.
* [ ] If key exists with status `PROCESSING` or `SUCCESS`, backend aborts execution and immediately returns the cached transaction response.
* [ ] If key does not exist, backend sets key with status `PROCESSING` and a **24-hour TTL**, proceeding to lock acquisition.



---

### Ticket `ORD-403`: High-Concurrency Valkey Distributed Locking (`SETNX`)

* **Module:** Order & Checkout Service (`Port 3003` / Upstash Valkey)
* **Priority:** 🔴 **Critical (P0 - Blocker)** * **Estimated Time:** 6 Hours
* **Description:** Implement the flash sale concurrency protection engine. Use Upstash Valkey to acquire mutually exclusive distributed locks on specific merchandise item IDs before evaluating or decrementing database inventory counters.
* **Design Patterns & Tactics:** Distributed Lock Pattern (`SETNX` with PX expiry), Pessimistic Concurrency Control.
* **Acceptance Criteria (AC):**
* [ ] Order creation executes Redis/Valkey command: `SET lock:item:{id} true NX PX 15000` (15-second TTL lock).
* [ ] If lock acquisition fails (another thread is purchasing the item), API immediately returns HTTP `409 Conflict`: `{ error: "LOCK_CONTENTION_DETECTED" }`.
* [ ] When lock is acquired, service checks MongoDB stock; if stock `> 0`, decrements stock by `-1` via temporary hold.
* [ ] Lock is reliably released via a `finally` block or Lua script upon transaction completion or failure.
* [ ] **Load Test Verification:** Simulating 500 concurrent requests for 50 hoodie units results in exactly **50 committed orders** and **0 oversold units**.



---

### Ticket `ORD-404`: Magic Value Payment Routing & Saga Compensating Rollbacks

* **Module:** Order & Checkout Service & Catalog Service (`Port 3002`)
* **Priority:** 🔴 **Critical (P0 - Blocker)** * **Estimated Time:** 6 Hours
* **Description:** Implement simulated payment routing using test card prefixes ("Magic Values"). Implement the Saga Pattern (Choreography) to manage cross-database consistency between PostgreSQL (Orders) and MongoDB (Catalog) during transaction failures.
* **Design Patterns & Tactics:** Saga Pattern (Choreography-based Distributed Transactions), Compensating Transaction Rollback.
* **Acceptance Criteria (AC):**
* [ ] If `mockCardNumber == "4242"`, Order Service commits order to PostgreSQL (`status: COMMITTED`), marks Mongo inventory deduction as permanent, releases Valkey lock, and emits `OrderPlaced` event.
* [ ] If `mockCardNumber == "4000"` (or blank), payment evaluation fails with HTTP `400 Bad Request`.
* [ ] Upon `4000` failure, Order Service aborts Postgres insert and fires an asynchronous **Compensating Transaction** command to Catalog Service (`POST /api/v1/catalog/:id/rollback`).
* [ ] Catalog Service increments MongoDB stock counter back by `+1` within **< 100ms**, releasing the Valkey lock.



---

## 📢 Phase 5: Notification Service & Fault Tolerance (Days 6–7)

### Ticket `NTF-501`: RabbitMQ Event Publisher (`OrderPlaced`) & Decoupling

* **Module:** Order Service (`Port 3003`) & Notification Worker
* **Priority:** 🟡 **High (P1)** * **Estimated Time:** 4 Hours
* **Description:** Decouple order checkout from notification broadcasting using CloudAMQP RabbitMQ. Configure the Order Service to publish event payloads upon transaction commits. Configure the standalone Notification Worker script to consume events asynchronously.
* **Design Patterns & Tactics:** Publish–Subscribe Pattern, Asynchronous Event Decoupling.
* **Acceptance Criteria (AC):**
* [ ] Upon Postgres transaction commit, Order Service publishes JSON payload to RabbitMQ exchange `order_events`: `{ orderId, studentEmail, itemName, timestamp }`.
* [ ] Order Service returns HTTP `200 OK` to the frontend immediately without waiting for notification processing (zero latency degradation).
* [ ] Background Worker (`2-notification-worker/worker.js`) successfully connects to CloudAMQP and logs message consumption from queue.



---

### Ticket `NTF-502`: Strategy Pattern (`InAppNotification`) & Observer Broadcasting

* **Module:** Notification Worker (Background Process)
* **Priority:** 🟡 **High (P1)** * **Estimated Time:** 4 Hours
* **Description:** Implement notification dispatch logic adhering to the Open/Closed Principle. Build a `NotificationStrategy` interface implementing `InAppNotificationStrategy` for initial sprint delivery. Use the Observer Pattern to push campus delivery time slots to student dashboards.
* **Design Patterns & Tactics:** Strategy Pattern (`NotificationStrategy`), Observer Pattern, Open/Closed Principle.
* **Acceptance Criteria (AC):**
* [ ] Worker defines a `NotificationStrategy` interface with an `execute(payload)` method.
* [ ] `InAppNotificationStrategy` processes consumed RabbitMQ events, writing delivery time slots to a `notifications` database table or emitting to polling clients.
* [ ] Code structure cleanly supports plugging in a future `EmailStrategy` or `WhatsAppStrategy` without modifying core consumer logic.



---

### Ticket `NTF-503`: Opossum Circuit Breaker & Exponential Backoff Retries

* **Module:** Notification Worker (Background Process)
* **Priority:** 🟡 **High (P1)** * **Estimated Time:** 4 Hours
* **Description:** Ensure fail-fast resilience against third-party API outages. Wrap external messaging dispatch attempts (e.g., simulated SMS/Email channels) in an Opossum Circuit Breaker paired with an exponential backoff retry mechanism.
* **Design Patterns & Tactics:** Circuit Breaker Pattern (`Opossum`), Exponential Backoff Retry Pattern.
* **Acceptance Criteria (AC):**
* [ ] External dispatch calls execute automated retries with exponentially increasing delays upon transient failures.
* [ ] If continuous failure thresholds exceed defined limits (e.g., 50% failure rate over 10 attempts), Opossum circuit breaker trips to `OPEN` state.
* [ ] In `OPEN` state, subsequent dispatch attempts fail fast instantly without executing network requests, logging a circuit-breaking exception.
* [ ] Circuit transitions to `HALF-OPEN` after a cooldown period to test upstream recovery.

**Revision note (2026-09-14):** this ticket was never executed. No `opossum` dependency exists in any service, and the Notification Service's RabbitMQ consumer has no retry or circuit-breaker logic — see the matching revision note on ADR-006 in `docs/ADR.md` and `docs/system-design/LLD/design-patterns/strategy-observer-pattern.md` for the (already-built) Strategy seam this would attach to whenever a real external channel is added.



---

## 🖥️ Phase 6: Utilitarian React Dashboard & Telemetry (Days 7–8)

**Revision note (2026-09-14):** the frontend that actually shipped (12 pages under `frontend/src/pages/`, plain Tailwind, no component library) took a simpler path than the "Diagnostic Control Panel" / "Architectural Telemetry Drawer" vision these tickets describe below — there is no live lock/latency telemetry drawer, no per-request cache-hit millisecond footer, and no colored educational toast badges for Saga rollback / rate-limit / lock-contention states. What *is* implemented and real: the size-fallback flow, the checkout state machine's retry behavior on `409`/`429` with `Retry-After`, and plain-text success/error messaging for every one of these backend states — just presented as ordinary UI copy instead of the specific "telemetry drawer" / badge language these tickets specify. Read the tickets below as the original UI ambition, not as a description of the shipped frontend.

### Ticket `UI-601`: Vite/React Bootstrap, Stateless Storage & Axios Interceptors

* **Module:** Frontend Client (React / Vite / Tailwind)
* **Priority:** 🟡 **High (P1)** * **Estimated Time:** 2 Hours
* **Description:** Initialize the ultra-light frontend dashboard. Configure native `localStorage` for stateless session persistence and set up Axios global interceptors to automate header injection across all outbound network requests.
* **Design Patterns & Tactics:** Stateless Session Client, Outbound/Inbound Client Interceptor Pattern.
* **Acceptance Criteria (AC):**
* [ ] React app initializes via Vite with Tailwind CSS utility classes operational.
* [ ] Login/Register view stores JWT, email (`@students.iiit.ac.in`), and `preferredSize` in `localStorage` upon authentication.
* [ ] Axios outbound interceptor automatically attaches `Authorization: Bearer <jwt>` to all API Gateway requests.
* [ ] Axios outbound interceptor automatically generates a `crypto.randomUUID()` and attaches it as `Idempotency-Key` on `POST`/`PUT` requests.



---

### Ticket `UI-602`: Diagnostic Catalog Grid, Live Stock Badges & Size Fallback Modal

* **Module:** Frontend Client (React / Vite / Tailwind)
* **Priority:** 🟡 **High (P1)** * **Estimated Time:** 3 Hours
* **Description:** Build the catalog feed (`/catalog`) and item detail checkout modal (`/catalog/:id`). Display real-time inventory counters and implement the interactive out-of-stock size fallback interception UI.
* **Design Patterns & Tactics:** Diagnostic Control Panel UI, Mechanical Transparency.
* **Acceptance Criteria (AC):**
* [ ] Catalog grid renders item cards with a prominent live badge: e.g., `Stock: 12 Units Remaining`.
* [ ] Footer renders Valkey cache telemetry: e.g., `⚡ GET /api/v1/catalog returned in 14ms (Valkey Cache Hit)`.
* [ ] Opening checkout modal auto-highlights the user's pre-saved size (e.g., `[L] Auto-Selected`).
* [ ] If size `L` is sold out, modal disables option `L`, renders yellow warning banner (*"⚠️ Saved Size [L] is out of stock. Manual fallback selection required."*), and mandates selecting an available size before enabling checkout button.



---

### Ticket `UI-603`: Interactive Checkout Control Panel & Saga Rollback Visualization

* **Module:** Frontend Client (React / Vite / Tailwind)
* **Priority:** 🔴 **Critical (P0 - Blocker)** * **Estimated Time:** 2 Hours
* **Description:** Build the interactive checkout test harness allowing interviewers to input Magic Values (`4242` / `4000`) and visually verify backend distributed lock contention, rate limiting, and Saga compensating transaction rollbacks.
* **Design Patterns & Tactics:** Deterministic Error Visualization, Interviewer Live-Telemetry.
* **Acceptance Criteria (AC):**
* [ ] Checkout modal includes text input: `"Mock Payment Card (Enter 4242 for Success, 4000 for Saga Rollback)"`.
* [ ] Submitting `4242` renders green success toast: `"✅ Order Committed! Valkey Lock Released. RabbitMQ Event Published."`.
* [ ] Submitting `4000` intercepts HTTP `400` response and renders educational Saga badge: `"🚨 Payment Failed (4000). Saga Compensating Transaction Executed: Stock counter incremented back by +1 in MongoDB."`.
* [ ] Intercepting HTTP `429` renders rate limit badge: `"⏳ Rate limit exceeded. Token bucket throttled request. Retry in [X] seconds."`.
* [ ] Intercepting HTTP `409` renders lock contention badge: `"🔒 Lock contention detected. Another thread is modifying inventory."`.



---

### Ticket `UI-604`: Super Admin Administration Panel (User Promotion & Club Creation)

* **Module:** Frontend Client (`/superadmin/root`)
* **Priority:** 🟢 **Medium (P2)** * **Estimated Time:** 2 Hours
* **Description:** Build the Super Admin's basic administrative panel: look up a user by email and promote them to `CLUB_ADMIN`, and create a new club while assigning its admin. **Revision note:** this ticket previously specified a microservice health matrix, database pool/queue-depth monitors, and Opossum circuit-breaker telemetry — that infrastructure-diagnostics scope has been dropped entirely (no such backend endpoints exist or are planned; see `SECURITY_AND_ACCESS.md` §5). Depends on `USR-204`.
* **Design Patterns & Tactics:** Application-Level Administration UI (not infrastructure observability), exact-match lookup (no directory/search).
* **Acceptance Criteria (AC):**
* [ ] An email input + "Find" action calls `GET /api/v1/users/lookup?email=` and displays the matched user's name/role/club, or a clear "not found" state.
* [ ] A "Promote to Club Admin" action on the found user calls `PUT /api/v1/users/:userId/role`; if the user already has a club, this is surfaced before the action is attempted.
* [ ] A "Create Club" form (name, description, admin email) calls `POST /api/v1/clubs` and displays the created club + assigned admin on success.
* [ ] No circuit-breaker badge, service-health grid, or queue-depth/connection-pool monitor is present anywhere on this page.



---

## 🐳 Phase 7: Phase 2 Containerization Polish (Final 1–2 Days)

### Ticket `DEV-701`: Microservice Containerization & Root Docker Compose

* **Module:** Container Orchestration (Phase 2 Polish)
* **Priority:** 🟡 **High (P1 - Resume Polish)** * **Estimated Time:** 4 Hours
* **Description:** Transition the tested, working modular system from local terminal ports into an enterprise-grade containerized deployment. Write individual `Dockerfile`s for each microservice and build a unified `docker-compose.yml` orchestrating the application cluster across a private Docker bridge network.
* **Design Patterns & Tactics:** Container Orchestration, Zero-Trust Private Docker Bridge Networking, Environmental Abstraction.
* **Acceptance Criteria (AC):**
* [ ] Standard, optimized 10-line `Dockerfile` exists within `1-main-api-server`, `2-notification-worker`, and frontend root directories.
* [ ] Root `docker-compose.yml` maps container ports `3000:3000` (Gateway), `3001:3001` (User), `3002:3002` (Catalog), and `3003:3003` (Order) across an internal bridge network `merch-internal-net`.
* [ ] API Gateway proxy routing rules cleanly transition from `http://localhost:3001` to internal container DNS hostnames (e.g., `http://user-auth-service:3001`).
* [ ] Running `docker-compose up -d` boots the entire distributed platform cleanly, passing all end-to-end user journeys (Idempotency, Valkey locking, Saga rollbacks) inside containers.



---

## 📊 Summary Matrix of Sprint Tickets

| Ticket ID | Module Domain | Priority | Est. Hours | Primary Architectural Target |
| --- | --- | --- | --- | --- |
| **`INF-101`** | DevOps & Infrastructure | 🔴 P0 | 3 hrs | `concurrently` workspace + Cloud DB Pooling (Neon/Atlas/Upstash) |
| **`GW-102`** | API Gateway (`Port 3000`) | 🔴 P0 | 4 hrs | Reverse Proxy Routing + `X-Internal-Service-Key` Zero-Trust Headers |
| **`GW-103`** | API Gateway (`Port 3000`) | 🟡 P1 | 4 hrs | Upstash Valkey Token Bucket Rate Limiter (`429`) + NoSQLi Defense |
| **`USR-201`** | User Service (`Port 3001`) | 🔴 P0 | 4 hrs | `@students.iiit.ac.in` Domain Gating + Bcrypt Password Hashing (`12` rounds) |
| **`USR-202`** | User Service (`Port 3001`) | 🟡 P1 | 4 hrs | Builder Pattern Student Profile + Saved Size PostgreSQL Persistence |
| **`USR-203`** | Auth Service / Gateway | 🔴 P0 | 4 hrs | Stateless JWT Issuance (`1h` TTL) + Tenant-Scoped RBAC (`clubId`) |
| **`USR-204`** | User Service (`Port 3001`) | 🟡 P1 | 3 hrs | Email Lookup (`GET /lookup`) + Role Promotion Guard + Transactional Club Creation |
| **`CAT-301`** | Catalog Service (`Port 3002`) | 🟡 P1 | 4 hrs | MongoDB Schema-less Attributes + Factory Pattern Item Instantiation |
| **`CAT-302`** | Catalog Service (`Port 3002`) | 🟡 P1 | 4 hrs | Cursor Pagination + Valkey Page-1 Feed Caching (`< 15ms` latency) |
| **`ORD-401`** | Order Service (`Port 3003`) | 🔴 P0 | 4 hrs | Automated Size Injection + Out-of-Stock Manual Fallback Interception |
| **`ORD-402`** | Order Service (`Port 3003`) | 🔴 P0 | 4 hrs | Valkey Idempotency Key Evaluation (`Idempotency-Key` UUID header) |
| **`ORD-403`** | Order Service (`Port 3003`) | 🔴 P0 | 6 hrs | Valkey Distributed Locking (`SETNX` / `PX 15000`) + Zero Overselling |
| **`ORD-404`** | Order & Catalog Services | 🔴 P0 | 6 hrs | Magic Value Payment (`4242`/`4000`) + Choreographed Saga Rollback |
| **`NTF-501`** | Order Service & Worker | 🟡 P1 | 4 hrs | RabbitMQ Event Publisher (`OrderPlaced`) + Async Decoupled Consumer |
| **`NTF-502`** | Notification Worker | 🟡 P1 | 4 hrs | Strategy Pattern (`InAppNotification`) + Observer Dashboard Broadcast |
| **`NTF-503`** | Notification Worker | 🟡 P1 | 4 hrs | Opossum Circuit Breaker (`CLOSED`/`OPEN`) + Exponential Backoff Retries |
| **`UI-601`** | Frontend Client | 🟡 P1 | 2 hrs | Vite/React Bootstrap + Stateless `localStorage` + Axios Interceptors |
| **`UI-602`** | Frontend Client | 🟡 P1 | 3 hrs | Diagnostic Catalog Feed + Live Stock Counters + Size Fallback Modal |
| **`UI-603`** | Frontend Client | 🔴 P0 | 2 hrs | Checkout Control Panel + Magic Value Inputs + Saga Error Badges (`400`) |
| **`UI-604`** | Frontend Client | 🟢 P2 | 2 hrs | Super Admin Admin Panel: Email Lookup + Promotion + Club Creation (no diagnostics) |
| **`DEV-701`** | DevOps (Phase 2 Polish) | 🟡 P1 | 4 hrs | Service `Dockerfile`s + Root `docker-compose.yml` Bridge Orchestration |
| **TOTALS** | **21 Executable Tickets** | — | **~81 hrs** | **Structured for an 8-Day Focused Engineering Sprint (~6–8 hrs/day)** |

---