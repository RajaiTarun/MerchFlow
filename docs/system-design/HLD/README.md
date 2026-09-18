# High-Level Design

Read in order — each file builds on the last.

| File | Covers |
|---|---|
| [01-system-context.md](01-system-context.md) | Who uses the system (Student / Club Admin / Super Admin) and the outermost box-and-arrow view: actors → gateway → services → stores |
| [02-service-architecture.md](02-service-architecture.md) | The gateway's actual proxy routing table and each service's real port/store, taken directly from `services/api-gateway/index.js` |
| [03-request-lifecycle-checkout.md](03-request-lifecycle-checkout.md) | The single most important diagram in this repo: the full checkout sequence, both the success and failure branch |
| [04-deployment-current-vs-planned.md](04-deployment-current-vs-planned.md) | What's actually running today (plain Node processes, cloud DBs) vs. what's planned (Docker Compose, private network) — kept strictly separate |
