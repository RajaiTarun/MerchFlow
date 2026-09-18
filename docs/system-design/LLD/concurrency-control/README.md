# Concurrency Control

Two mechanisms, both living in `services/order-service/routes/orders.js`, both backed by Valkey — and frequently confused with each other because they sit right next to each other in the same handler. The sharp distinction:

- **[Distributed locking](distributed-locking.md)** answers "can two *different* requests for the *same item* run at once?" — no.
- **[Idempotency](idempotency.md)** answers "if the *same request* (same client, same click) arrives twice, does it get executed twice?" — no.

A lock without idempotency would still let a retried request re-enter the flow and take the lock a second time, reserving stock twice. Idempotency without a lock would still let two different students race each other for the last unit. This project needed both, for two different reasons.
