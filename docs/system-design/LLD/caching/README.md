# Caching

One doc: [catalog-feed-cache.md](catalog-feed-cache.md) — the Valkey cache in front of the catalog feed, including a real bug that was found and fixed (stale reads across filtered vs. unfiltered requests), every actual invalidation call site, and the measured hit/miss latency numbers (with why cross-region network latency dominates the absolute values).
