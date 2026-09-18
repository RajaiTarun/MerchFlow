# Caching

One doc: [catalog-feed-cache.md](catalog-feed-cache.md) — the Valkey cache in front of the catalog feed, including a real bug that was found and fixed (stale reads across filtered vs. unfiltered requests), every actual invalidation call site, and measured latency numbers checked against the aspirational figure quoted in `docs/PRD.md`.
