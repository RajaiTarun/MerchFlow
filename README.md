<div align="center">

# MerchFlow

**A polyglot microservices platform for campus merch drops** — built to survive the one moment that actually matters: 500 students hitting checkout on the same 50-unit hoodie at the same second, and the inventory count still landing on exactly zero.

[![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](services/)
[![React](https://img.shields.io/badge/React-19-149ECA?style=for-the-badge&logo=react&logoColor=white)](frontend/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](services/user-service/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](services/catalog-service/)
[![RabbitMQ](https://img.shields.io/badge/RabbitMQ-FF6600?style=for-the-badge&logo=rabbitmq&logoColor=white)](services/notification-service/)
[![Valkey](https://img.shields.io/badge/Valkey-DC382D?style=for-the-badge&logo=redis&logoColor=white)](services/catalog-service/cache/valkey.js)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](docker-compose.yml)
[![Render](https://img.shields.io/badge/Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)](render.yaml)

`5 services` · `2 databases` · `1 message broker` · `4 design patterns` · `0 oversells`

**Live**: [frontend-6jke.onrender.com](https://frontend-6jke.onrender.com) — free-tier services sleep after 15 idle minutes, so the first load can take ~30–60s to wake up. Not broken, just cheap.

</div>

---

### Contents
[The problem](#the-problem) · [What's actually being tested](#whats-actually-being-tested-here) · [Architecture](#architecture-in-words) · [Frontend](#frontend) · [Running it locally](#running-it-locally) · [Deployed on Render](#-deployed-on-render) · [What's deliberately not here](#whats-deliberately-not-here) · [Repo layout](#repo-layout)

---

## 🎯 The problem

Every club on campus runs its own merch drop through a Google Form and a spreadsheet. Students re-enter their size for the fifth time this semester. Flash sales oversell because nothing is actually locking inventory — two people "win" the last hoodie, and someone has to get an awkward refund DM. Club admins find out an item is sold out by refreshing a sheet.

MerchFlow centralizes this into one portal, and uses it as an excuse to build the distributed-systems mechanics that a spreadsheet-replacement app has no *business* needing — because that's the actual point of the project.

## 🔐 What's actually being tested here

Anyone can build a CRUD app that lists items and takes orders. The part worth reading is what happens *under contention*:

| Failure mode | Mechanism | Where |
|---|---|---|
| Two requests both see "1 left" and both succeed | Distributed lock (`SET NX PX` + Lua-scripted release, so you can only unlock with the token you locked with) | [`order-service/routes/orders.js`](services/order-service/routes/orders.js) |
| A double-click or network retry charges/orders twice | Idempotency key, checked and written atomically in Valkey, TTL'd for 24h | same file |
| Payment fails *after* stock was already decremented | Saga-style compensating transaction, restores stock with 3 retries (100ms/200ms backoff) before giving up and logging it as a manual-intervention case | [`compensateInventory.js`](services/order-service/utils/compensateInventory.js) |
| Naive rate limiter lets a burst drive the counter negative | Read-then-decrement replaced with a single atomic Lua script — the actual bug, actual fix, written up below | [`api-gateway/middleware/rateLimiter.js`](services/api-gateway/middleware/rateLimiter.js) |
| A checkout writes to two different databases | No 2PC — MongoDB stock and Postgres order state are reconciled by the saga above, not a distributed transaction | `catalog-service` + `order-service` |

Design patterns aren't sprinkled in for the sake of a resume line — each one is solving a real seam in the system:

- **Factory** — builds the right item subtype (apparel needs sizes, a mug doesn't) → [`MerchandiseFactory.js`](services/catalog-service/factories/MerchandiseFactory.js)
- **Builder** — assembles a student's profile field-by-field → [`StudentProfileBuilder.js`](services/user-service/models/StudentProfileBuilder.js)
- **Command** — captures everything a checkout needs to execute as one object → [`OrderCommand.js`](services/order-service/models/OrderCommand.js)
- **Strategy + Observer** — the RabbitMQ consumer fires an event at a broadcaster, which fans it out to whichever delivery strategies are registered, without knowing or caring how any of them actually deliver → [`NotificationBroadcaster.js`](services/notification-service/observers/NotificationBroadcaster.js)

## 🏗️ Architecture, in words

Five independent Node/Express services sit behind an API gateway that owns JWT verification, RBAC, per-route rate limiting, and header-injected trust boundaries (a service never trusts a client-supplied `userId` or `clubId` — those come from the verified token, injected as headers downstream can trust).

> Full HLD/LLD breakdown — sequence diagrams, design-pattern rationale, rejected alternatives — lives in [`docs/system-design/`](docs/system-design/). The rest of `docs/` (PRD, ADRs, security spec) is older planning material, still being brought up to date.

| Service | Owns | Store |
|---|---|---|
| **API Gateway** | Auth, RBAC, rate limiting, request routing | — |
| **User Service** | Registration (`@students.iiit.ac.in` only), login, profiles, roles, club creation | PostgreSQL |
| **Catalog Service** | Item listings, stock reservation/rollback/commit, feed caching | MongoDB + Valkey |
| **Order Service** | Checkout, locking, idempotency, saga compensation | PostgreSQL + Valkey |
| **Notification Service** | Consumes order/delivery events, persists in-app notifications | PostgreSQL |

The two databases exist for a reason, not just to pad the stack: merchandise attributes are wildly irregular (a mug needs `volume_ml`, a hoodie needs `availableSizes`, an accessory needs neither) — forcing that into relational tables means EAV tables or `JSONB` gymnastics. Orders need the opposite: ACID guarantees and row-level locking under contention, which is exactly what Postgres is for. So the catalog lives in Mongo, orders live in Postgres, and the two are reconciled at the application layer via the saga above — there's no foreign key holding this together, on purpose.

Valkey (the open-source Redis fork, post-2024 license change) does two unrelated jobs and I kept them separate on purpose: caching the unfiltered first page of the catalog feed, and holding the per-item distributed lock during checkout. Notification delivery goes through RabbitMQ so a slow or dead notification consumer can never add latency to — or fail — an order that already committed.

## 💻 Frontend

A small React 19 + React Router SPA (Tailwind v4, no component library) — 12 pages, three role tiers gated client-side by `ProtectedRoute` and server-side by the gateway regardless. Notification and stock-count "live updates" are `setInterval` polling (15s and 10s respectively), not WebSockets — that was a deliberate call: the actual overselling guarantee is enforced by the atomic lock-and-decrement at checkout time, not by what a page happens to be displaying, so the UI only needs to be "fresh enough to trust," not real-time-push-perfect.

## ⚙️ Running it locally

Two ways to run it — same managed cloud databases either way (Postgres/Mongo/Valkey/RabbitMQ), so there's nothing local to stand up regardless of which you pick.

**Plain Node processes** — fastest inner loop while actively changing code:
```bash
npm install
npm run dev                                    # all 5 backend services, via workspaces

cd frontend && npm install && npm run dev      # separately
```

**Docker Compose** — closer to how it's actually deployed:
```bash
docker compose up --build
```
Builds and runs all 6 services (5 backend + the frontend behind nginx) from their own `Dockerfile`s. The only thing that changes between the two modes is how each service finds the others: `http://localhost:3001` locally vs. `http://user-service:3001` (Docker's internal DNS) in Compose — same code path either way, picked up from an env var with `localhost` as the default. That same indirection is also what makes the Render deployment below possible without a second code change.

<details>
<summary><strong>Required environment variables</strong> (repo-root <code>.env</code>)</summary>

```
DATABASE_URL=            # Postgres (Neon/Supabase — needs sslmode=require)
MONGODB_URI=             # MongoDB Atlas
VALKEY_URL=              # Upstash or any Valkey/Redis-compatible instance
RABBITMQ_URL=            # CloudAMQP
JWT_SECRET=
INTERNAL_SERVICE_KEY=    # shared secret for service-to-service calls
PORT=                    # gateway (3000)
USER_SERVICE_PORT / CATALOG_SERVICE_PORT / ORDER_SERVICE_PORT / NOTIFICATION_SERVICE_PORT
```

Gateway on `:3000`, frontend on `:5173`, backend services on `:3001`–`:3004`. Each service has its own `db/setup.js` / `migrate*.js` to run once against a fresh database. Docker Compose reads this same file via `env_file: .env`.

</details>

To poke at the interesting part directly: place an order with mock card `4242` (succeeds) or `4000` (fails and rolls back inventory) — no real payment gateway, this is a controlled way to force both branches of the saga on demand.

## 🚀 Deployed on Render

All 6 services deploy from one [`render.yaml`](render.yaml) blueprint — the 5 backend services built straight from their existing `Dockerfile`s, the frontend as a Static Site rather than another container (nothing to run for pure static output, and unlike a free web service it never sleeps).

The one real discovery from actually deploying this, worth knowing before you copy this setup: **Render's free tier lets a service *send* private-network requests but not *receive* them.** The "gateway public, everything else network-isolated" design in [`SECURITY_AND_ACCESS.md`](docs/SECURITY_AND_ACCESS.md) can't be built with genuine network isolation on the free tier at all — Private Services (the type with no public URL) have no free instance type, and even a free *public* Web Service can't accept inbound traffic from another service's private-network call. So every backend service here does have a public URL, whether it's meant to or not, and inter-service calls go over it — plain HTTPS, same as any two unrelated services talking over the internet. What actually stops someone from hitting `catalog-service`'s public URL directly is the same `X-Internal-Service-Key` check every service already enforces in its `internalAuthMiddleware` — that check never cared which network a request arrived over. So the real security model didn't change; only the "traffic never leaves Render's backbone" nicety got traded away, and that part costs money.

## 🚫 What's deliberately not here

- **No WebSockets/SSE.** Covered above — polling was the right tradeoff for what this actually needs to guarantee.
- **No delete for items or clubs.** No backend route for either exists; wasn't in scope and didn't want a half-implemented soft-delete.
- **No circuit breaker on notification dispatch**, despite it being in the original design docs — the current notification path (RabbitMQ → Postgres) has nothing external to trip a breaker on yet. It's the obvious next thing to add the moment `NotificationStrategy` grows a real third-party channel.
- **No searchable user directory** for Super Admin — email lookup only, on purpose, so promoting someone to Club Admin doesn't quietly become a way to browse every student's data.

None of these are gaps I didn't notice — they're in [`learnings.md`](learnings.md) and the QA checklist, along with the actual bugs that got found and fixed along the way (a stale-cache invalidation bug, an IDOR on profile updates, a rate limiter that could go negative under load). I'd rather a README be accurate about scope than pad it with things that don't exist yet.

## 📂 Repo layout

```
services/
  api-gateway/           auth, RBAC, rate limiting, routing        (+ Dockerfile)
  user-service/          auth, profiles, roles, clubs        → PostgreSQL   (+ Dockerfile)
  catalog-service/       items, stock, feed cache             → MongoDB + Valkey  (+ Dockerfile)
  order-service/         checkout, locking, saga              → PostgreSQL + Valkey  (+ Dockerfile)
  notification-service/  event consumption, dispatch          → PostgreSQL   (+ Dockerfile)
frontend/                React 19 + Tailwind SPA                  (+ Dockerfile, nginx.conf)
docs/
  system-design/         HLD/LLD diagrams + design-pattern rationale (current, interview-ready)
  *.md                   PRD, ADRs, security spec (older planning docs, being updated)
docker-compose.yml       local multi-service run, mirrors the Render topology
render.yaml              Render Blueprint — deploys all 6 services on the free plan
```

---

<div align="center">

Built solo as a systems-design-focused portfolio project, not a bootcamp CRUD clone — the goal was to hit real concurrency and consistency problems and actually deal with them, not simulate a happy path.

</div>
