# Low-Level Design

Organized by *concern*, not by service — most of these mechanisms cut across two or three services (a lock lives in Order Service but protects a resource in Catalog Service; auth is enforced at the gateway but re-checked downstream). Reading LLD by service would mean explaining half of each mechanism twice.

| Concern | Folder | One-line summary |
|---|---|---|
| Design patterns | [design-patterns/](design-patterns/) | Factory, Builder, Command, Strategy+Observer — where each is used and what it's actually solving |
| Concurrency control | [concurrency-control/](concurrency-control/) | The distributed lock (per-item mutual exclusion) and idempotency (safe retries) — two different problems, often confused |
| Saga & compensation | [saga-and-compensation/](saga-and-compensation/) | What happens when a checkout fails after stock is already reserved |
| Caching | [caching/](caching/) | The catalog feed cache — key strategy, every invalidation site, and the real measured numbers vs. the aspirational ones in `docs/PRD.md` |
| Rate limiting | [rate-limiting/](rate-limiting/) | The token-bucket limiter, the real race condition it used to have, and the atomic Lua fix |
| Auth & access control | [auth-and-access-control/](auth-and-access-control/) | JWT/RBAC flow, tenant isolation, and a full case study of a real IDOR vulnerability that was found and fixed |
| Data modeling | [data-modeling/](data-modeling/) | The Postgres `orders` schema (with its denormalized columns) and the Mongo `Item` schema, and why they're split across two engines |

Every file in here names at least one rejected alternative — not as a formality, but because "why not X" is the question that actually gets asked in an interview once you've explained what was built.
