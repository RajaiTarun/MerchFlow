# Catalog Feed Cache

**Where:** `services/catalog-service/routes/catalog.js` — `CACHE_KEY`, `shouldUseCache`, `invalidateCatalogCache()`.

## The problem it solves

`GET /api/v1/catalog` is the single most frequently hit read path in the system — every student browsing during a flash sale hits it repeatedly. Serving every request from MongoDB means every page load pays a full database round-trip; caching the response avoids that for the common case (an unfiltered first page of results).

## The cache-key strategy — and a real bug in the first version of it

Only the truly unfiltered first page is cached:

```js
const isFirstPage = !cursor;
const shouldUseCache = isFirstPage && !type && !clubId;
```

This condition exists because of a real bug (`learnings.md` #1): the first version cached under one fixed key (`catalog:feed:page:1`) *regardless* of the `type`/`clubId` query params. A club-filtered request and an unfiltered request would clobber each other's cached entry for up to 60 seconds — a student filtering by "Music Club" could be served a cached response that was actually the full unfiltered catalog, or vice versa. The fix was `shouldUseCache`, guarding *both* the cache read and the cache write — filtered requests (`type` or `clubId` present) always hit MongoDB directly and never touch the cache key at all.

## Every real invalidation call site

Four different write paths can change what the cached unfiltered first page should look like, and all four call `invalidateCatalogCache()` (`redis.del(CACHE_KEY)`) immediately after their DB write succeeds:

| Route | Why it invalidates |
|---|---|
| `POST /` (create item) | A new item could belong on page 1 |
| `PUT /:itemId/delivery-slot` | Changes a field visible in the cached listing |
| `PATCH /:id/stock` (reserve) | Changes `stock`, visible in the cached listing |
| `PATCH /:id/rollback` (saga compensation) | Also changes `stock` — restores it |

The last two were **not** invalidating the cache in an earlier version (`learnings.md` #5) — only `POST /` and the delivery-slot update did. A real checkout could leave the cached listing showing pre-checkout stock for up to 60 seconds even though the underlying MongoDB number was already correct, because `PATCH /:id/stock` and `PATCH /:id/rollback` don't have "create" or "update" in their names the way the first two routes do, and were missed in the first pass. The takeaway that's worth repeating: when auditing "every write path that can make a cached read stale," check every route that touches the cached *field*, not just the routes with obviously cache-relevant names.

## Measured numbers vs. the planning-doc claim

`docs/PRD.md` and `docs/FRONTEND_SPEC_DOCUMENT.md` both quote a `< 50ms` cache-hit target. That number was never actually measured against this deployment topology, and turned out not to hold:

**Measured (3 rounds, local machine → Neon/Atlas/Upstash, `learnings.md` #4):**

| | Average latency |
|---|---|
| Cache miss (cold, hits MongoDB) | ≈336ms |
| Cache hit (served from Valkey) | ≈207ms |

Cache hits are consistently ~40% faster than misses — the mechanism is genuinely working, verified against the actual log lines (`Cache miss: querying MongoDB` → `Page 1 cached in Valkey for 60s` → `cache hit : serving page 1 from valkey`). But **207ms is nowhere near `< 50ms`.** The reason: both a hit and a miss still pay a network round-trip from a local machine to a cloud service (Upstash) over the public internet; a hit merely *skips the second round-trip* (to MongoDB Atlas) that a miss pays on top of the first. The actual in-memory cache lookup inside Valkey is sub-millisecond — the 207ms is almost entirely network latency to a different cloud region, which a `< 50ms` figure implicitly assumed away by picturing co-located services (e.g. the still-unbuilt Docker Compose deployment in [04-deployment-current-vs-planned.md](../../HLD/04-deployment-current-vs-planned.md)).

This is worth stating plainly in an interview rather than repeating the planning doc's number: **the cache is correctly implemented and measurably effective, and the specific `< 50ms` figure was aspirational, not verified against the environment it was actually measured in.** Being able to say that — and explain *why* the gap exists — is a stronger answer than either quoting the wrong number confidently or not having measured it at all.

## What was rejected, and why

A full cache of every filtered query combination (per `type`, per `clubId`, per cursor) was implicitly rejected in favor of caching only the single highest-traffic case (unfiltered page 1). This trades cache coverage for simplicity: filtered browsing always pays the MongoDB cost, but there's exactly one cache key to reason about, one invalidation target, and no cache-key-explosion problem as more filter combinations get used.

## Honest limit

The cache has a 60-second TTL as its only staleness bound *in addition to* explicit invalidation — meaning even without a missed invalidation site, any two requests within the same 60-second window could theoretically see slightly different views of the world if an invalidation call itself fails (both cache writes are wrapped in try/catch and treated as non-fatal, so a Valkey hiccup during either the read or the write silently falls back to querying MongoDB directly — safe, but worth knowing that failure mode exists).
