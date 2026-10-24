# High-Level Design

Read in order — each file builds on the last.

| File | Covers |
|---|---|
| [01-system-context.md](01-system-context.md) | Who uses the system (Student / Club Admin / Super Admin) and the outermost box-and-arrow view: actors → frontend → gateway → services → stores |
| [02-service-architecture.md](02-service-architecture.md) | The gateway's actual route table, per-prefix middleware chain, and each service's real port and stores, taken directly from `services/api-gateway/index.js` |
| [03-request-lifecycle-checkout.md](03-request-lifecycle-checkout.md) | The single most important diagram in this repo: the full checkout sequence, the success and failure branches, and every early exit |
| [04-deployment.md](04-deployment.md) | The three ways the system runs (plain Node, Docker Compose, Render free tier), all against the same managed cloud stores, and what that means for security |
