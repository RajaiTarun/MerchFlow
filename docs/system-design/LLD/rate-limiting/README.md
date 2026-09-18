# Rate Limiting

One doc: [token-bucket-limiter.md](token-bucket-limiter.md) — the gateway's Valkey-backed token bucket, a real race condition it had in production-like testing (a bucket that got stuck rate-limiting forever), and the atomic Lua fix. This is one of the strongest "found a real bug, fixed it, verified it" stories in the whole project — treat it accordingly in an interview.
