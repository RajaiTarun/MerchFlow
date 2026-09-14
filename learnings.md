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

### 4. Catalog cache is real, but the "< 50ms hit" doc claim was aspirational, not measured

**Finding:** Manually verified `GET /catalog`'s Valkey caching (see #1) by clearing the cache key, then timing a cold request followed by several warm ones, cross-checked against the catalog-service log lines (`Cache miss: querying MongoDB` → `Page 1 cached in Valkey for 60s` → `cache hit : serving page 1 from valkey`). The mechanism itself is correct and working exactly as designed.

**Measured (3 rounds, local dev machine against Neon/Atlas/Upstash):** MISS ≈ 336ms avg, HIT ≈ 207ms avg — cache hits are consistently ~40% faster, but nowhere near the `< 50ms` cache-hit figure quoted in `PRD.md` / `FRONTEND_SPEC_DOCUMENT.md`.

**Why the gap:** both a hit and a miss still pay a network round-trip to a cloud service from a local machine — a hit just skips the *second* round-trip (to MongoDB Atlas) that a miss pays on top of the first (to Upstash). The absolute numbers here are dominated by cloud network latency, not by the actual cache-lookup cost, which is genuinely sub-millisecond. Co-located services (e.g. the project's planned Docker Compose deployment) would show a much sharper gap, since that network latency mostly drops out.

**Takeaway:** a caching layer can be implemented completely correctly and still miss a specific latency number quoted in planning docs, if that number assumed a deployment topology (co-located services) different from where it's actually being measured (local machine → multiple separate cloud regions). Verify performance claims against the actual measurement environment before citing them as fact.

---

### 5. Checkout's own stock-mutating endpoints never invalidated the catalog cache

**Problem:** `PATCH /:id/stock` (reserve) and `PATCH /:id/rollback` (saga compensation) both change `stock`, but neither called `invalidateCatalogCache()` — only `POST /` and `PUT /:itemId/delivery-slot` did (see #1). So a real checkout could leave the cached unfiltered `/catalog` listing showing stale stock for up to 60s, even though the underlying number was correct. Found via frontend testing: after placing a real order, the item detail and catalog pages kept showing the pre-order stock count.

**Fix:** added the same `invalidateCatalogCache()` call to both routes, right after their DB write succeeds - identical pattern to the two routes that already had it. Verified: warmed the cache, ran a checkout, confirmed the cache key was gone afterward and the logs showed `Invalidated cached page 1 after catalog change` firing from both the reservation and the compensation paths.

**Also fixed on the frontend (not a backend bug, but the same underlying "user might be looking at a stale number" concern):** the item detail page never refetched stock after a successful order, and had no way to notice if *someone else's* checkout changed the count while the page sat open. Added a refetch immediately after a successful order, plus light polling (every 10s) while the page is open. Explicitly not WebSockets/SSE - the actual overselling guarantee was never based on what's displayed (the atomic DB-level check-and-decrement at checkout time is what matters), so this only needed to be as fresh as "good enough for a human to trust," not real-time-push-perfect.

**Takeaway:** when auditing a system for "every write path that can make a cached read stale," check every route that mutates the cached field, not just the ones with obvious names (`POST`/`PUT` on the item itself) - `PATCH .../stock` and `PATCH .../rollback` mutate the exact same field and were just as capable of going stale.

---

### 6. Club Orders showed a raw item id and no student info - denormalized student_email onto orders instead of a new lookup endpoint

**Problem:** `GET /orders/club` only ever returned `catalog_item_id` and `user_id` — no item name, no way to tell which student placed an order. Found via frontend testing of the Club Admin's order-fulfillment page.

**Two different fixes for two different root causes:**
- **Item name:** resolvable client-side for free — the admin page was already fetching the club's item list (`GET /catalog?clubId=`) for the delivery-slot feature, so the order rows just look the id up against that already-fetched list. No backend change needed.
- **Student email:** genuinely not available anywhere without either (a) a new lookup endpoint, or (b) denormalizing it. Chose (b), following the exact precedent already set by `club_id` on this same table (`migrate6.js`/`backfillClubId.js`): the checkout handler already has the student's email sitting in the decoded JWT (it was already being used to build the `studentEmail` field on the `OrderPlaced` RabbitMQ event) — persisting it into the `orders` row at insert time means every future read is free, no cross-service call, no new endpoint, no new permission-scope question.

**Why not a new endpoint:** the obvious alternative — a `GET /users/by-ids` batch lookup — would have meant deciding whether Club Admins should be allowed to resolve arbitrary user info at all. Right now only `SUPER_ADMIN` can do that (`GET /users/lookup`, email-only). Denormalizing sidesteps the question entirely: `student_email` becomes just another column on a row already scoped by `club_id`.

**Fix:** `migrate7.js` adds the nullable column; `backfillStudentEmail.js` fills in pre-existing rows (calling `GET /profile/:userId` with `x-user-id` set to that same id, mirroring how the live checkout flow already satisfies that endpoint's ownership check); the checkout `INSERT` now includes `decoded.email`; `GET /orders/club`'s `SELECT` now returns it. Verified both paths live: backfilled 5 pre-existing orders correctly, then placed a brand-new real checkout and confirmed the response already carried the right `student_email` with no backfill needed.

**Takeaway:** before reaching for a new endpoint to resolve "id → readable info," check whether the writer already had that info in hand at write time. If it did, denormalizing avoids a whole category of decisions (extra latency, new permission scope, cache invalidation for yet another endpoint) that a read-time lookup would force. The tradeoff (a snapshot, not a live value) is often *correct* for exactly this kind of record — an order should show who placed it *at the time*, the same way a shipping label freezes a name at the moment of shipping.

---

### 7. Same lesson, one order sooner: denormalized item_name too, and it deleted code instead of adding it

**Follow-up finding:** the student's own "My Orders" page (`GET /orders`) had the identical problem `GET /orders/club` had for item names — only `catalog_item_id` available, no name. The naive fix (client-side resolution) doesn't even work cleanly here the way it did for the club-scoped page: a student's orders can span *any* club's items, so there's no single `?clubId=` to fetch a lookup list from — it would need paging through the entire catalog, or N individual `GET /catalog/:id` calls, every page load.

**Fix:** applied the exact same denormalization as #6 — `item_name` added to `orders` (`migrate8.js`/`backfillItemName.js`), populated at checkout time from `item.name` (already fetched during checkout, already used for the `OrderPlaced` event's `itemName` field — third reuse of data the handler already had).

**Bonus this time:** since `ClubOrdersPage` had *only* been fetching the club's item list to resolve names (nothing else used that `items` state), denormalizing let that whole second fetch — the `Promise.all`, the `items` state, and the `itemName()` helper — be deleted outright. The fix didn't just avoid adding a lookup; it let an existing one be removed.

**Takeaway:** when the same "id with no readable label" shape shows up a second time, check whether the *first* fix's technique still applies before reusing it blindly — client-side resolution only worked for Club Orders because it was scoped to one club; it wouldn't have generalized to a page with no such scope. Denormalization, once adopted for one field, tends to compound: the second field is nearly free to add (same migration/backfill pattern, same insert-time data source), and it can retroactively simplify code written before the pattern existed.

---

### 8. Notifications "update on their own" via polling, not push

**Verified during manual QA:** the Notifications page picks up new notifications without a manual refresh. There's no WebSocket or SSE anywhere in this backend — it's a plain `setInterval(fetchNotifications, 15000)` inside a `useEffect` (with `clearInterval` on unmount) in `NotificationsPage.jsx`, just re-fetching `GET /notifications` every 15s and replacing the list.

**Takeaway:** "live-updating UI" doesn't require real-time infrastructure if the freshness bar is "a human notices within ~15 seconds," not "instant." Polling is the simplest thing that satisfies the actual requirement here, and it's honest about what's really happening — no fake real-time claims. The same pattern (light polling) was also used for item-detail stock freshness (#5).

---

### 9. Rate limiter's check-then-decrement wasn't atomic — got a real, permanently-stuck bucket during manual testing

**Problem:** hit live while manually testing the Create Item form as a Club Admin — got `RATE_LIMITED` on an ordinary request, no burst of traffic to explain it. Investigating in Valkey directly: the bucket's counter had gone negative-or-zero *and* had **no expiry at all** (`PTTL` = -1, meaning "never expires"). Since the check (`if (parseInt(current) <= 0)`) never resets a key, and nothing else ever deletes it, a key in this state blocks that IP **forever**, not just for the intended 60-second window.

**Root cause:** `createRateLimiter`'s check-then-decrement was two separate Valkey round trips — `GET` to read the count, then `DECR` to consume a token — not one atomic operation. Two concurrent requests from the same IP (very plausible here: multiple browser tabs, 10s item-detail stock polling, and heavy manual+automated testing all sharing one machine's IP) can both `GET` the same "1 token left" value before either has `DECR`'d, so both pass the `> 0` check and both decrement — driving the counter below zero instead of stopping cleanly at 0. That explains the negative counter. The missing TTL is a separate, less certain factor — likely related to the Valkey connectivity blips hit repeatedly during this project (see the entries in this file about `ETIMEDOUT`/`EHOSTUNREACH` requiring backend restarts) — but regardless of that story, the race condition itself was real, reproducible, and worth fixing on its own.

**Fix:** replaced the two-step check with one atomic Lua script (`RATE_LIMIT_SCRIPT`), the same technique this codebase already uses for the distributed lock's `LUA_RELEASE_LOCK` — Redis/Valkey executes a Lua script as a single atomic unit, so no other command can interleave between the read and the decrement. The script also defensively re-applies the key's expiry (`PEXPIRE`) on every path if it's ever found missing, so a bucket can self-heal instead of getting permanently stuck even if something *does* strip its TTL again in the future.

**Verified:**
- Fired 50 truly concurrent requests (`xargs -P 50`) at a fresh bucket (limit 1000) → counter landed at exactly `950`, not negative — proves the race is gone.
- Manually expired a key, waited past expiry, confirmed the next request started a brand-new window at `999` with a fresh TTL — proves normal regeneration works.
- Manually recreated the exact stuck-forever bug (counter `0`, no TTL at all) and confirmed the very next request self-healed it to a fresh 60s TTL instead of staying stuck.

**Takeaway:** "check a value, then act on it" across two separate network calls is never safe under concurrency, even for something as simple as a counter — this is the identical class of bug idempotency keys and distributed locks exist to prevent elsewhere in this same codebase, just easier to miss in a 5-line rate limiter than in the checkout flow. When a bug shows up as "permanently stuck" rather than "occasionally wrong," check whether the fix should also be defensive (self-healing on next use), not just correct for the normal path — a purely atomic fix would have stopped the counter going negative, but wouldn't by itself have recovered a key that already lost its TTL some other way.

---

