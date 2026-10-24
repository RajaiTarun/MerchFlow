# Security & Access Specification

**Project:** Centralized College Merchandise Management System

**Document Version:** 3.0

**Status:** Describes the implemented system

**Architecture:** Microservices behind an API Gateway; Docker Compose for local runs, Render (free tier) for deployment

**Revision note (2026-10-24):** rewritten to match the code.
- **Removed (never true of the built system):**
  - private-network isolation of backend services and databases
  - NoSQL sanitization middleware (`express-mongo-sanitize` was removed, see `learnings.md` #2)
  - idempotency and registration checks "at the gateway" (they live in the Order and User services)
  - the earlier diagnostics-panel history
- **Added:**
  - how identity reaches downstream services
  - the full endpoint permission table
  - how deployment actually works on Render
  - a list of known gaps

---

## 1. Core Security Strategy

The platform relies on four practical controls instead of an enterprise compliance framework:

1. **Domain-restricted onboarding:** only `@students.iiit.ac.in` addresses can register.
2. **Stateless authentication and role control:** short-lived JWTs, three roles, and Club Admins scoped to their own club.
3. **Abuse prevention:** Valkey-backed rate limiting at the gateway, and checkout idempotency in the Order Service.
4. **Service-to-service trust:**
   - Every backend service accepts only requests carrying a shared internal key. This is the boundary, not network isolation.
   - Connections to the managed data stores go over TLS.

---

## 2. Authentication & Authorization (Authn / Authz)

### 2.1 Domain-Gated Registration (`@students.iiit.ac.in`)

Account creation is restricted by email domain instead of email verification links or OTPs. The check runs in the User Service's registration route:

* **Regex Rule:** `^[a-zA-Z0-9._%+-]+@students\.iiit\.ac\.in$`
* **Enforcement:**
  * Any other domain (e.g. `@gmail.com`) or subdomain is rejected with `403 Forbidden`, before the database is queried.
  * Missing fields return `400`.
  * An already-registered email returns `409`.

### 2.2 Password Security (bcrypt)

* Passwords are hashed with **bcrypt** (salt rounds = 12) in the User Service before they are stored in PostgreSQL. Login compares against the hash; plaintext passwords are never stored.

### 2.3 Stateless Session Management (JWT)

On successful login, the **User Service** issues a JWT signed with the shared `JWT_SECRET`, with a **1-hour expiry**:

```json
{
  "sub": "<user uuid>",
  "email": "aarav.sharma@students.iiit.ac.in",
  "role": "CLUB_ADMIN",
  "clubId": "<club uuid, or null for users without a club>"
}
```

* **Verification:** the **API Gateway** verifies the token (signature and expiry) on every protected route. A missing, invalid, or expired token returns `401`.
* **How identity reaches downstream services:** backend services do not re-verify the token; they rely on the gateway having done so. They learn the caller's identity in two ways:
  * **Gateway-set headers, derived from the verified JWT:**
    * `x-user-id`, set on the profile routes;
    * `x-user-role`, set on all catalog and order routes;
    * `x-club-id`, set on all catalog and order routes when the user has a club.
  * **Decoding the forwarded `Authorization` header** without re-verifying it. The Order Service and Notification Service do this to read the user id.
* **Why trusting these is acceptable:** backend services only accept requests that carry the internal service key (§4.2), which only the gateway and other backend services hold.

### 2.4 Role-Based Access Control (RBAC) & Club Scoping

There are three roles: `STUDENT`, `CLUB_ADMIN` and `SUPER_ADMIN`. Club scoping is enforced in two layers:
* the gateway's role checks decide **whether** a role may use a route at all;
* the owning service decides **which club's data** a Club Admin may touch, by comparing the resource's club with the gateway-set `x-club-id`. A Club Admin acting on another club's item or order gets `403 Forbidden`.

| Action / Endpoint | Student | Club Admin | Super Admin |
| --- | --- | --- | --- |
| **Register / Log in** (`POST /api/v1/users/register`, `POST /api/v1/users/login`) | ✅ Public | ✅ Public | ✅ Public |
| **Manage own profile** (`PUT /api/v1/users/profile`, `PUT /api/v1/users/size`, `GET /api/v1/users/profile/:userId`) | ✅ Own only | ✅ Own only | ✅ Own only |
| **Browse catalog** (`GET /api/v1/catalog`, `GET /api/v1/catalog/:id`) | ✅ Allow | ✅ Allow | ✅ Allow |
| **List clubs** (`GET /api/v1/clubs`) | ✅ Allow | ✅ Allow | ✅ Allow |
| **Checkout** (`POST /api/v1/orders`) | ✅ Allow | ✅ Allow | ✅ Allow |
| **Own orders** (`GET /api/v1/orders`, `GET /api/v1/orders/:id`) | ✅ Own only | ✅ Own only | ✅ Own only |
| **Own notifications** (`GET /api/v1/notifications`, `PATCH /api/v1/notifications/:id/read`) | ✅ Own only | ✅ Own only | ✅ Own only |
| **Publish an item** (`POST /api/v1/catalog`) | ❌ Deny | ✅ Own club | ✅ Any club (must name it) |
| **Set a delivery slot** (`PUT /api/v1/catalog/:id/delivery-slot`) | ❌ Deny | ✅ Own club's items | ✅ Any item |
| **View club orders** (`GET /api/v1/orders/club`) | ❌ Deny | ✅ Own club | ✅ Any club (`?clubId=`) |
| **Mark an order delivered** (`PATCH /api/v1/orders/:orderId/status`) | ❌ Deny | ✅ Own club's orders | ✅ Any order |
| **Look up a user by email** (`GET /api/v1/users/lookup?email=`) | ❌ Deny | ❌ Deny | ✅ Allow |
| **Change a user's role** (`PUT /api/v1/users/:userId/role`) | ❌ Deny | ❌ Deny | ✅ Allow |
| **Create a club and assign its admin** (`POST /api/v1/clubs`) | ❌ Deny | ❌ Deny | ✅ Allow |

* **Checkout:** every role may check out. There is no student-only restriction, by design.
* **Ownership:** "own only" rows take the caller's identity from the JWT, never from the URL or body. A request for someone else's order or notification returns `404` or `403`.
* **Scope of this table:** it describes the access model the gateway's role checks and the services' ownership checks implement on these routes.

---

## 3. Gateway Defenses

```
[Public Internet / Users]
           │
           ▼  (HTTPS; the only entry point the frontend uses)
┌──────────────────────────────────────────────────────────┐
│                    EXPRESS API GATEWAY                   │
│  ├── 1. JWT verification (protected routes)              │
│  ├── 2. Role checks (scoped to specific routes)          │
│  ├── 3. Rate limiting (Valkey, catalog + orders routes)  │
│  ├── 4. Route allow-list (only intended paths forwarded) │
│  └── 5. Identity headers + internal service key added    │
└──────────────────────────────────────────────────────────┘
           │  (internal key on every proxied request)
           ▼
[User Service]   [Catalog Service]   [Order Service]   [Notification Service]
```

### 3.0 Route Allow-Listing

Each proxied prefix forwards **only the paths it is meant to expose**; the
gateway answers `404` for anything else *before* it reaches a backend
(`allowOnly(...)` in `index.js`). This matters because user-service serves two
routers (auth and clubs) at the same base path, so without it a request under
`/api/v1/clubs` could reach an auth route such as `/:userId/role`, and the
catalog/orders prefixes would expose internal service-to-service routes. The
allow-list is what guarantees the access table in §2.4 — a route that isn't
listed for a prefix simply cannot be reached through that prefix.

### 3.1 Rate Limiting (Valkey)

* **What is limited:** all requests under `/api/v1/catalog` and `/api/v1/orders`. User, club, and notification routes are not rate-limited.
* **Keying:** a separate counter per route group per client IP (`rate_limit:{catalog|orders}:{ip}`).
* **Mechanism:** a Lua script runs the read-and-decrement atomically in Valkey, and every path through it guarantees the key has an expiry, so a bucket can't get stuck. In practice this is a fixed-window counter: the full allowance comes back when the key expires. The code and `docs/system-design/LLD/rate-limiting/token-bucket-limiter.md` call it a token bucket.
* **Current configuration:** 100 requests per 60 seconds for catalog, and 5 for orders, set in `services/api-gateway/middleware/rateLimiter.js`.
* **Client identity:** the gateway sets `trust proxy`, so behind a reverse proxy (Render, Docker) `req.ip` is the real client IP from `X-Forwarded-For`, and each client gets its own bucket rather than all clients sharing the proxy's address.
* **When exceeded:** the gateway returns `429 Too Many Requests`.

### 3.2 Double-Submit Protection (Idempotency)

Checkout idempotency is enforced by the **Order Service**, not the gateway:

* **The header:** every checkout must include an `Idempotency-Key` header (a UUID); without it the request is rejected with `400`.
* **The record:** the key is stored in Valkey as `idempotency:order:{key}`. It is first set to `PROCESSING` with `SET NX`, so two concurrent duplicates can't both claim it. On success it is replaced with `SUCCESS` plus the cached response, kept for 24 hours.
* **Duplicates:**
  * a repeat after success returns the cached response (`200`) without placing a second order;
  * a repeat while the first is still processing returns `409`;
  * if checkout fails, the key is cleared so the client can retry.
* **Valkey unavailable:** checkout returns `503` rather than proceeding without protection.

### 3.3 Injection Defense

* **SQL injection (PostgreSQL):** every query in the User, Order, Notification, and Catalog services uses parameterized queries through the `pg` library (`$1, $2, …` placeholders). No SQL is built by string interpolation of request data.
* **NoSQL injection (MongoDB):** there is no dedicated sanitization middleware; `express-mongo-sanitize` was removed because it never ran on real routes (`learnings.md` #2). Current protections:
  * **Query strings:** Express 5's default "simple" query parser doesn't build nested objects, so operator payloads such as `?clubId[$ne]=x` can't reach a Mongo filter through the query string.
  * **Request bodies:** these are validated before use. Examples: item fields go through the domain constructors (via `MerchandiseFactory`), and stock quantities must be positive integers.

---

## 4. Network & Inter-Service Security

### 4.1 Where the Services Run

* **Local (`npm run dev`):** the gateway runs on port 3000 and the backend services on 3001-3004, as plain local processes.
* **Local (`docker compose up --build`):** all six containers (five services plus the nginx-served frontend) share Compose's default network.
  * Only the gateway (3000) and the frontend (5173) are published to the host.
  * The data stores are not containers here: PostgreSQL (Neon), MongoDB Atlas, Valkey (Upstash), and RabbitMQ (CloudAMQP) are managed cloud services in both local modes.
* **Deployed (Render free tier):** free Render web services can send private-network requests but can't receive them. So **every backend service has a public HTTPS URL**, and inter-service calls travel over the public internet. Network isolation is not part of the security model; the internal service key (§4.2) is the boundary.

### 4.2 Inter-Service Communication Key

* **Every backend service rejects requests without the key:** each service mounts a global middleware that requires a matching `X-Internal-Service-Key` header and returns `403` otherwise. This covers every route, including `/health`, and is mounted before any route.
* **Who holds the key:** the gateway adds it to every request it proxies. The Order Service and Notification Service add it to their direct service-to-service calls. These calls are:
  * Order → User: fetch the student's profile at checkout;
  * Order → Catalog: read the item, reserve, commit, and roll back stock;
  * Notification → Order: find the users who ordered an item.
* **What it does and doesn't prove:** the key proves a request came through the gateway or from another backend service. It says nothing about the end user. User-level authorization comes from the gateway's JWT and role checks (§2).

### 4.3 Data Store Connections

* **PostgreSQL:** connections use TLS when `DATABASE_URL` contains `sslmode=require`, which the managed providers require. The pool is configured with `rejectUnauthorized: false`, so traffic is encrypted but the server certificate is not verified (§6).
* **MongoDB, Valkey, RabbitMQ:** TLS is governed by each provider's connection URL.
* **Secrets:** all secrets (database URLs, `JWT_SECRET`, `INTERNAL_SERVICE_KEY`) live in the repo-root `.env` locally (git-ignored) and in the Render dashboard in deployment. None are committed.

---

## 5. Super Admin Administration

The Super Admin's capabilities are application-level only. There are no infrastructure diagnostics endpoints (service-health aggregation or queue/pool monitoring), and none are planned.

* **`GET /api/v1/users/lookup?email=`** (`SUPER_ADMIN` only): exact-match lookup of a user by email. It returns id, name, role, and club, so the Super Admin can decide whether to promote them. It is deliberately not a searchable directory.
* **`PUT /api/v1/users/:userId/role`** (`SUPER_ADMIN` only): changes a user's role, e.g. promoting them to `CLUB_ADMIN` for an existing club. A user already assigned to a club must be demoted first, which prevents silently moving an existing Club Admin to a different club.
* **`POST /api/v1/clubs`** (`SUPER_ADMIN` only): creates a club and, in the same database transaction, assigns the user identified by `admin_email` as its Club Admin, promoting them from `STUDENT` if needed.
  * If either step fails, neither is saved.
  * A `SUPER_ADMIN`, or a user who already belongs to a club, can't be assigned this way.

### 5.1 Self-Profile Identity Is JWT-Derived, Never Client-Supplied

* **Through the gateway:** `GET /api/v1/users/profile/:userId` returns a user's own profile (name, phone, hostel block, preferred size). The caller's identity always comes from the verified JWT's `sub` claim, never from the `:userId` path parameter.
  * The gateway sets `x-user-id` from the JWT, the same mechanism used for `PUT /profile` and `PUT /size`.
  * The User Service returns `403` if `:userId` doesn't match that header. A caller can only ever retrieve their own profile, whatever `:userId` they put in the URL.
* **From the Order Service:** it calls this endpoint directly during checkout to fetch the student's saved size. It sets `x-user-id` itself, to the `sub` from that student's JWT. This is safe because it only ever requests the checking-out student's own profile.

---

## 6. Known Gaps

These are documented so the spec doesn't overstate the system. None of them is fixed yet.

* **Identity headers aren't stripped:** the gateway overwrites `x-user-role` on catalog and order routes, and overwrites `x-club-id` only when the user has a club. It never deletes client-supplied `x-user-id`, `x-user-role` or `x-club-id` headers. Every route that reads them today is either role-gated or overwrites them, so this is defense in depth, not a known exploit. Stripping them at the gateway would close it off.
* **PostgreSQL certificate verification is off:** connections are encrypted, but `rejectUnauthorized: false` means the server certificate isn't verified (§4.3).
* **Open CORS:** the gateway allows any origin (`cors()` with defaults). Tokens are sent in the `Authorization` header, not cookies, which limits the impact, but an explicit allow-list for the frontend's origin would be tighter.
