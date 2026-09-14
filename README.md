# MerchFlow

**A polyglot microservices platform for campus merch drops** — built to survive the one moment that actually matters: 500 students hitting checkout on the same 50-unit hoodie at the same second, and the inventory count still landing on exactly zero.

`Node.js` `React 19` `PostgreSQL` `MongoDB` `RabbitMQ` `Valkey`

---

## The problem

Every club on campus runs its own merch drop through a Google Form and a spreadsheet. Students re-enter their size for the fifth time this semester. Flash sales oversell because nothing is actually locking inventory — two people "win" the last hoodie, and someone has to get an awkward refund DM. Club admins find out an item is sold out by refreshing a sheet.

MerchFlow centralizes this into one portal, and uses it as an excuse to build the distributed-systems mechanics that a spreadsheet-replacement app has no *business* needing — because that's the actual point of the project.

## What's actually being tested here

Anyone can build a CRUD app that lists items and takes orders. The part worth reading is what happens *under contention*:

| Failure mode | Mechanism | Where |
|---|---|---|
| Two requests both see "1 left" and both succeed | Distributed lock (`SET NX PX` + Lua-scripted release, so you can only unlock with the token you locked with) | [`order-service/routes/orders.js`](services/order-service/routes/orders.js) |
| A double-click or network retry charges/orders twice | Idempotency key, checked and written atomically in Valkey, TTL'd for 24h | same file |
| Payment fails *after* stock was already decremented | Saga-style compensating transaction, restores stock with 3 retries (100ms/200ms backoff) before giving up and logging it as a manual-intervention case | [`compensateInventory.js`](services/order-service/utils/compensateInventory.js) |
| Naive rate limiter lets a burst drive the counter negative | Read-then-decrement replaced with a single atomic Lua script — the actual bug, actual fix, written up below | [`api-gateway/middleware/rateLimiter.js`](services/api-gateway/middleware/rateLimiter.js) |
| A checkout writes to two different databases | No 2PC — MongoDB stock and Postgres order state are reconciled by the saga above, not a distributed transaction | `catalog-service` + `order-service` |

Design patterns aren't sprinkled in for the sake of a resume line — each one is solving a real seam in the system: **Factory** for building the right item subtype (apparel needs sizes, a mug doesn't) ([`MerchandiseFactory.js`](services/catalog-service/factories/MerchandiseFactory.js)), **Builder** for assembling a student's profile field-by-field ([`StudentProfileBuilder.js`](services/user-service/models/StudentProfileBuilder.js)), **Command** for capturing everything a checkout needs to execute as one object ([`OrderCommand.js`](services/order-service/models/OrderCommand.js)), and **Strategy + Observer** for notification dispatch — the RabbitMQ consumer fires an event at a broadcaster, which fans it out to whichever delivery strategies are registered, without knowing or caring how any of them actually deliver ([`NotificationBroadcaster.js`](services/notification-service/observers/NotificationBroadcaster.js)).

## Architecture, in words

Five independent Node/Express services sit behind an API gateway that owns JWT verification, RBAC, per-route rate limiting, and header-injected trust boundaries (a service never trusts a client-supplied `userId` or `clubId` — those come from the verified token, injected as headers downstream can trust). *(HLD/LLD diagrams are still being drawn up properly — dropping them in here once they're done instead of a rushed Mermaid box.)*

| Service | Owns | Store |
|---|---|---|
| **API Gateway** | Auth, RBAC, rate limiting, request routing | — |
| **User Service** | Registration (`@students.iiit.ac.in` only), login, profiles, roles, club creation | PostgreSQL |
| **Catalog Service** | Item listings, stock reservation/rollback/commit, feed caching | MongoDB + Valkey |
| **Order Service** | Checkout, locking, idempotency, saga compensation | PostgreSQL + Valkey |
| **Notification Service** | Consumes order/delivery events, persists in-app notifications | PostgreSQL |

The two databases exist for a reason, not just to pad the stack: merchandise attributes are wildly irregular (a mug needs `volume_ml`, a hoodie needs `availableSizes`, an accessory needs neither) — forcing that into relational tables means EAV tables or `JSONB` gymnastics. Orders need the opposite: ACID guarantees and row-level locking under contention, which is exactly what Postgres is for. So the catalog lives in Mongo, orders live in Postgres, and the two are reconciled at the application layer via the saga above — there's no foreign key holding this together, on purpose.

Valkey (the open-source Redis fork, post-2024 license change) does two unrelated jobs and I kept them separate on purpose: caching the unfiltered first page of the catalog feed, and holding the per-item distributed lock during checkout. Notification delivery goes through RabbitMQ so a slow or dead notification consumer can never add latency to — or fail — an order that already committed.

## Frontend

A small React 19 + React Router SPA (Tailwind v4, no component library) — 12 pages, three role tiers gated client-side by `ProtectedRoute` and server-side by the gateway regardless. Notification and stock-count "live updates" are `setInterval` polling (15s and 10s respectively), not WebSockets — that was a deliberate call: the actual overselling guarantee is enforced by the atomic lock-and-decrement at checkout time, not by what a page happens to be displaying, so the UI only needs to be "fresh enough to trust," not real-time-push-perfect.

## Running it locally

There's no Docker Compose yet (that's a planned Phase 2, not done) — everything runs as plain Node processes talking to managed cloud databases, which is genuinely easier for local dev than standing up 4 datastores yourself.

```bash
# root — installs and runs all 5 backend services via workspaces
npm install
npm run dev

# separately — the frontend
cd frontend && npm install && npm run dev
```

You'll need a `.env` at the repo root with:

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

Gateway on `:3000`, frontend on `:5173`, backend services on `:3001`–`:3004`. Each service has its own `db/setup.js` / `migrate*.js` to run once against a fresh database.

To poke at the interesting part directly: place an order with mock card `4242` (succeeds) or `4000` (fails and rolls back inventory) — no real payment gateway, this is a controlled way to force both branches of the saga on demand.

## What's deliberately not here

- **No WebSockets/SSE.** Covered above — polling was the right tradeoff for what this actually needs to guarantee.
- **No delete for items or clubs.** No backend route for either exists; wasn't in scope and didn't want a half-implemented soft-delete.
- **No circuit breaker on notification dispatch**, despite it being in the original design docs — the current notification path (RabbitMQ → Postgres) has nothing external to trip a breaker on yet. It's the obvious next thing to add the moment `NotificationStrategy` grows a real third-party channel.
- **No searchable user directory** for Super Admin — email lookup only, on purpose, so promoting someone to Club Admin doesn't quietly become a way to browse every student's data.

None of these are gaps I didn't notice — they're in [`learnings.md`](learnings.md) and the QA checklist, along with the actual bugs that got found and fixed along the way (a stale-cache invalidation bug, an IDOR on profile updates, a rate limiter that could go negative under load). I'd rather a README be accurate about scope than pad it with things that don't exist yet.

## Repo layout

```
services/
  api-gateway/         auth, RBAC, rate limiting, routing
  user-service/        auth, profiles, roles, clubs        → PostgreSQL
  catalog-service/     items, stock, feed cache             → MongoDB + Valkey
  order-service/       checkout, locking, saga              → PostgreSQL + Valkey
  notification-service/ event consumption, dispatch         → PostgreSQL
frontend/              React 19 + Tailwind SPA
docs/                  PRD, ADRs, security spec
```

---

Built solo as a systems-design-focused portfolio project, not a bootcamp CRUD clone — the goal was to hit real concurrency and consistency problems and actually deal with them, not simulate a happy path.
