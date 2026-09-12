# Security & Access Specification: Lean Sprint Edition

**Project:** Centralized College Merchandise Management System

**Document Version:** 2.0 (Simplified Sprint Focus)

**Status:** Approved for Engineering Sprint

**Target Architecture:** Decoupled Microservices with Private Docker Networking

---

## 1. Core Security Strategy

Instead of complex enterprise compliance frameworks, the security architecture focuses on **four practical engineering pillars** engineered to protect a campus merchandise platform during high-concurrency flash sales:

1. **Domain-Restricted Onboarding:** Gating access to university students without email verification overhead.
2. **Stateless Authentication & Role Control:** Lightweight JWTs with strict tenant-scoped permissions.
3. **High-Concurrency Abuse Prevention:** Valkey-backed rate limiting and transaction idempotency.
4. **Network & Database Isolation:** Securing cloud database connections via encrypted TLS/SSL during Phase 1 development and isolating internal microservices behind a zero-trust private Docker bridge network during Phase 2 containerized deployment.

---

## 2. Authentication & Authorization (Authn / Authz)

### 2.1 Domain-Gated Registration (`@students.iiit.ac.in`)

To eliminate the engineering overhead of sending email verification links or OTPs, account creation is gated at the API Gateway via strict regex matching:

* **Regex Rule:** `^[a-zA-Z0-9._%+-]+@students\.iiit\.ac\.in$`
* **Enforcement:** Registration attempts using external domains (`@gmail.com`) or invalid subdomains are rejected immediately with an HTTP `403 Forbidden` before querying the database.

### 2.2 Password Security (Bcrypt)

* User passwords are hashed using **bcrypt** (with `salt rounds = 12`) in the User Service before saving to PostgreSQL.
* This provides computationally intensive, adaptive protection against rainbow tables and brute-force attacks without requiring heavy memory tuning.

### 2.3 Stateless Session Management (JWT)

The API Gateway handles user login and issues a signed JSON Web Token (JWT) with a **1-hour TTL**. Downstream microservices authenticate requests statelessly by reading the JWT claims:

```json
{
  "sub": "usr_987654321",
  "email": "aarav.sharma@students.iiit.ac.in",
  "role": "CLUB_ADMIN",
  "clubId": "club_tech_01"
}

```

### 2.4 Role-Based Access Control (RBAC) & Tenant Isolation

Access routes are strictly gated by three operational tiers. Furthermore, **Club Admins are strictly tenant-isolated**: if an admin from the "Tech Club" (`clubId: club_tech_01`) attempts to modify inventory or broadcast notifications for the "Sports Club," the request is denied with an HTTP `403 Forbidden`.

| Action / Endpoint | Student | Club Admin | Super Admin |
| --- | --- | --- | --- |
| **Browse Catalog** (`GET /api/v1/catalog`) | ✅ Allow | ✅ Allow | ✅ Allow |
| **Manage Saved Size Profile** (`PUT /api/v1/users/profile`) | ✅ Allow (Own) | ✅ Allow (Own) | ✅ Allow (Own) |
| **Execute Checkout** (`POST /api/v1/orders`) | ✅ Allow | ✅ Allow | ✅ Allow |
| **Manage Merchandise & Caps** (`POST /api/v1/catalog`) | ❌ Deny | ✅ Allow (Own Club) | ✅ Allow (Any Club) |
| **Broadcast Delivery Slots** (`PUT /api/v1/catalog/:id/delivery-slot`) | ❌ Deny | ✅ Allow (Own Club) | ✅ Allow (Any Club) |
| **Look Up a User by Email** (`GET /api/v1/users/lookup?email=`) | ❌ Deny | ❌ Deny | ✅ Allow |
| **Promote a User to Club Admin** (`PUT /api/v1/users/:userId/role`) | ❌ Deny | ❌ Deny | ✅ Allow |
| **Create a Club (+ assign its Club Admin)** (`POST /api/v1/clubs`) | ❌ Deny | ❌ Deny | ✅ Allow |

**Revision note (2026-09-11):** this table previously denied Club Admin/Super Admin checkout and listed a `GET /health/detailed` "Manage Clubs & System Health" capability. Neither reflected the finalized project scope: **Club Admin and Super Admin are explicitly allowed to place orders** like any other authenticated user (there is no `STUDENT`-only checkout restriction, by design), and there is **no infrastructure-diagnostics endpoint** (`/health/detailed`, service-health aggregation, circuit-breaker status, or queue-depth monitoring) anywhere in this system — that capability was replaced with concrete application-level Super Admin actions: looking up a user by email, promoting a user to `CLUB_ADMIN`, and creating a club while assigning its admin. See §5 below for the endpoints these three rows correspond to.

---

## 3. Flash Sale Threat Mitigation (Gateway Defense)

```
[Public Internet / Users]
           │
           ▼ (Port 3000 exposed)
┌────────────────────────────────────────────────────────┐
│                   EXPRESS API GATEWAY                  │
│  ├── 1. Rate Limiting (Valkey Token Bucket)            │
│  ├── 2. Replay Defense (Valkey Idempotency Key)        │
│  └── 3. Sanitization (Parameterized SQL + NoSQLi Strip)│
└────────────────────────────────────────────────────────┘
           │ (Private Docker Bridge Network - Hidden)
           ▼
[User Service]   [Catalog Service]   [Order Service]   [Notification Service]

```

### 3.1 Rate Limiting (Valkey Token Bucket)

To prevent scraping bots or checkout spam during a limited-edition hoodie drop, the API Gateway tracks request counts in Valkey:

* **Catalog Browsing (`GET`):** Max **100 requests / min** per IP.
* **Order Checkout (`POST`):** Max **5 checkout attempts / min** per JWT.
* Exceeding these limits triggers an immediate HTTP `429 Too Many Requests` response.

### 3.2 Double-Charge Protection (Idempotency)

To prevent network lag or accidental double-clicks from charging a student twice:

* The checkout payload must include an `Idempotency-Key` (UUIDv4) in the HTTP headers.
* The API Gateway checks Valkey (`GET idempotency:order:{key}`). If the key exists, the request is blocked and the cached result is returned. If not, the transaction proceeds to the Order Service.

### 3.3 Database Injection Defense

* **SQL Injection (Postgres):** All database queries in the User and Order services strictly use **Parameterized Queries / Prepared Statements** via `pg-pool`, treating user inputs strictly as safe data literals.
* **NoSQL Injection (MongoDB):** The Catalog Service uses middleware (`express-mongo-sanitize`) to strip MongoDB query operators (`$`, `.`) from payloads, preventing query logic overriding.

---

## 4. Network Isolation & Inter-Service Security

### 4.1 Two-Phase Network Isolation Strategy

To maintain security across both local development and production deployment without infrastructure overhead, network boundaries are enforced via two distinct tiers:

* **Phase 1 (Local Development Tier):** Backend microservices run as independent OS processes bound to local ports (3000–3003). Communication with managed serverless cloud databases (Neon PostgreSQL, MongoDB Atlas, Upstash Valkey, CloudAMQP RabbitMQ) is strictly authenticated and encrypted over TLS/SSL (sslmode=require), preventing unencrypted data transmission over public networks.
* **Phase 2 (Containerized Deployment Tier):** When packaged via Docker Compose for production deployment, internal infrastructure is completely isolated from the public internet. Only the API Gateway exposes a public host port (Port 3000 or Port 80). All backend microservices, databases, and message brokers reside on an internal Docker user-defined bridge network, rendering internal service ports completely unreachable from external IP addresses.

### 4.2 Inter-Service Communication Key

When internal services communicate with each other (e.g., Order Service calling User Service to fetch a student's saved size profile), requests attach a shared environment secret in the header (`X-Internal-Service-Key`). Downstream services verify this header to ensure the request originated from an authentic internal microservice rather than a spoofed external source.

Internal-only endpoints (e.g. Catalog Service's stock reservation/rollback/commit routes, Order Service's by-item user lookup used by Notification Service) are reachable only by another backend service presenting this key. They are **not** part of the public API surface and must never be called directly by a frontend client.

---

## 5. Super Admin Administration (replaces the earlier "Diagnostics Panel" concept)

An earlier revision of this specification and the frontend spec envisioned a Super Admin "Diagnostics Panel" — aggregated microservice health, circuit-breaker status, database pool/queue-depth monitoring. **That is no longer part of project scope.** No such endpoints exist, and none are planned; a college-project admin panel does not need enterprise-grade observability. The Super Admin's actual, implemented capabilities are all application-level administration:

* **`GET /api/v1/users/lookup?email=`** (`SUPER_ADMIN` only) — exact-match lookup of a user by email, returning their id/name/role/club so the Super Admin can decide whether to promote them. This is intentionally minimal: it is not a searchable user directory, and none is planned.
* **`PUT /api/v1/users/:userId/role`** (`SUPER_ADMIN` only) — promotes a user to `CLUB_ADMIN` (or changes their role otherwise). A user already assigned to a club (non-null `club_id`) must be demoted first — this prevents a Super Admin from silently reassigning an existing Club Admin to a different club.
* **`POST /api/v1/clubs`** (`SUPER_ADMIN` only) — creates a new club and, in the same database transaction, assigns the user identified by `admin_email` as its Club Admin (promoting them from `STUDENT` if needed). Clubs are therefore no longer permanently fixed/pre-seeded data — this is now a normal, supported write path. A `SUPER_ADMIN` cannot be assigned as a club's admin this way, and the same "must not already have a club" rule above applies.

### 5.1 Self-Profile Identity Is JWT-Derived, Never Client-Supplied

`GET /api/v1/users/profile/:userId` returns a user's own profile (name, phone, hostel block, preferred size). The authenticated caller's identity for this purpose is **always** taken from the verified JWT's `sub` claim — never from the `:userId` path parameter. The API Gateway attaches the JWT-derived id as a trusted `x-user-id` header (the same mechanism already used for `PUT /profile` and `PUT /size`), and user-service rejects the request with `403` if `:userId` doesn't match that header. A caller can therefore only ever retrieve their own profile through this endpoint, regardless of what `:userId` they put in the URL.

---