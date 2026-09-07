# Learnings

Problems hit during development + how they were solved. Kept short for interview revision.

---

### 1. Catalog stale-cache bug (Valkey)

**Problem:** `GET /catalog` cached page 1 under one fixed key (`catalog:feed:page:1`) regardless of `type`/`clubId` query params. A filtered request and an unfiltered request would clobber each other's cached result for up to 60s — e.g. a club-filtered feed could get served to a user who asked for the full catalog.

**Fix:** Only cache the truly unfiltered first page. Added `shouldUseCache = isFirstPage && !type && !clubId` and used it (instead of `isFirstPage`) to guard both the cache read and cache write. Filtered requests always hit MongoDB directly.

**Second half of the same bug:** creating an item or updating a delivery slot didn't invalidate the cache, so a new item could stay invisible on the feed for up to 60s after creation. Fixed by calling `redis.del(CACHE_KEY)` right after the DB write succeeds in both `POST /` and `PUT /:itemId/delivery-slot`.

**Takeaway:** a cache key must encode every input that changes the response, and every write path that can make a cached read stale needs an explicit invalidation step — caching isn't "free" once there's more than one way to produce or change the data being cached.

---

### 2. `/health` crash on API Gateway (Express 5 + express-mongo-sanitize)

**Problem:** `GET /health` on the gateway threw `TypeError: Cannot set property query of #<IncomingMessage> which has only a getter`. `express-mongo-sanitize@2.2.0` sanitizes NoSQL-injection payloads (e.g. `{ "password": { "$ne": null } }`) by reassigning `req.query = sanitized`. Express 5 made `req.query` a getter-only property (parsed fresh from the URL on every read), so that assignment throws. No newer version of the package fixes this (still at 2.2.0 on npm).

**Extra finding:** the middleware was mounted *after* the catalog/orders/users proxy routes, which fully handle and end matching requests before Express reaches it. So it never actually sanitized any real user input — it only ever ran on `/health`, which touches none. It was dead weight that happened to crash the one route it reached.

**Fix:** removed `express-mongo-sanitize` entirely (middleware + dependency) rather than trying to patch/replace it — it wasn't protecting anything to begin with, so removing it doesn't reduce real security posture, it just stops crashing.

**Takeaway:** an unmaintained dependency can silently stop doing its job (via middleware ordering) well before it starts throwing errors — worth checking *whether* a middleware is even reachable for the routes you think it protects, not just whether it runs without crashing.

---

### 3. Broken authorization on profile/size updates (IDOR)

**Problem:** `PUT /profile` and `PUT /size` (user-service) took `user_id` straight from the request body and updated that row — no check on who was actually calling. The gateway also had no `authMiddleware` at all on `/api/v1/users`. Net effect: any caller could edit **any other user's** profile or preferred size just by putting a different `user_id` in the JSON body. Classic IDOR (Insecure Direct Object Reference) — trusting a client-supplied id instead of the authenticated session's identity.

**Constraint:** couldn't just slap auth on the whole `/api/v1/users` prefix — `/register` and `/login` live there too and must stay public (no JWT exists yet at login time).

**Fix:** added a small gateway-side middleware scoped only to `PUT /profile` and `PUT /size` (same pattern already used for catalog's mutation routes) that runs `authMiddleware`, then injects `x-user-id: req.user.sub` (from the verified JWT) as a trusted header. user-service now reads `user_id` from that header instead of `req.body.user_id`. Body-supplied `user_id` is no longer read at all.

**Verified:** registered two users, logged in as A, called `PUT /profile`/`PUT /size` with B's `user_id` in the body — update landed on A's own row every time, B's row was untouched. No token at all → `401`. `/register`/`/login` still work unauthenticated.

**Takeaway:** for "act on my own account" endpoints, never trust an id the client can set (body/query/params) — always derive identity from the verified token, and inject it downstream as a header the client can't forge, not as something re-read from client input.

---

