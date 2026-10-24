# Saga Rollback

**Where:** the `catch` block in `services/order-service/routes/orders.js` `POST /`, calling `compensateInventory` (`services/order-service/utils/compensateInventory.js`).

## The problem it solves

A checkout touches two databases that don't share a transaction: MongoDB (Catalog Service, stock) and PostgreSQL (Order Service, the order record). The code deliberately reserves stock in Mongo *first*, then evaluates payment, then inserts into Postgres. If payment fails (or any error happens) after the stock reservation succeeds, there's no 2PC to roll both back together — something has to explicitly tell Catalog Service "undo that reservation." That something is the compensating transaction. This is an **orchestrated saga with Order Service as the orchestrator**: Order Service drives every step itself (reserve, then commit or compensate) and directly calls Catalog Service's rollback endpoint when it detects its own failure. There's no *separate* coordinator service — the orchestrator lives inside Order Service — and no event-driven rollback: Catalog Service never decides on its own to undo anything.

## How it actually works

```mermaid
sequenceDiagram
    participant O as Order Service
    participant Cat as Catalog Service
    participant Mongo as MongoDB

    Note over O: stock already reserved (inventoryReserved = true)<br/>payment evaluation throws (mockCardNumber !== "4242")
    loop attempt 1..3, sleep 100ms then 200ms between
        O->>Cat: PATCH /:id/rollback {reservationId}
        Cat->>Mongo: startSession + withTransaction:<br/>1. find InventoryReservation by reservationId<br/>2. check InventoryCompensation doesn't already exist<br/>3. findOneAndUpdate stock += reservation.quantity<br/>4. mark reservation COMPENSATED<br/>5. insert InventoryCompensation record
        alt success
            Cat-->>O: 200 {alreadyCompensated: false}
            Note over O: loop exits, compensationResult.success = true
        else timeout / network error (3s timeout per attempt)
            Cat--xO: error
            Note over O: continue loop unless this was attempt 3
        end
    end
    alt all 3 attempts failed
        Note over O: console.error 'CRITICAL: Inventory compensation failed after retries'<br/>NO further automated recovery — logged only
    end
    Note over O: idempotency key deleted either way — 400/500 returned to client
```

The retry loop (`compensateInventory.js`) tries up to 3 times with 100ms then 200ms backoff (`attempt * 100`ms) and a 3-second timeout per attempt. If all 3 fail, the code does exactly one thing: logs `CRITICAL: Inventory compensation failed after retries` and returns `{ success: false }` to the caller, which returns the original error (e.g. `400 PAYMENT_FAILED`) to the client anyway. **There is no dead-letter queue, no manual-intervention ticket, no alerting integration** — "CRITICAL" here means "grep-worthy in the logs," not "someone gets paged." This is a real, acknowledged gap, not an oversight papered over — a fully productionized version of this would need at minimum a way to surface these failures for manual reconciliation.

**Idempotent on the Catalog Service side, deliberately:** the rollback handler checks for an existing `InventoryCompensation` record for the same `reservationId` before touching stock, and a MongoDB unique index on `reservationId` in both `InventoryReservation` and `InventoryCompensation` is the final backstop if two rollback requests for the same reservation somehow race each other. This matters because Order Service's retry loop calls the *same* rollback endpoint repeatedly — without idempotency on the receiving end, a successful-but-slow first attempt followed by a retry could double-restore stock.

## What was rejected, and why

- **Two-phase commit (2PC)** across Postgres and MongoDB was rejected in `docs/ADR.md` (ADR-005) for the standard reason: there's no shared transaction coordinator between a relational and a document database in this stack, and even where 2PC-like support exists, it trades away exactly the kind of loose coupling and independent scaling this project's whole microservices decision (ADR-001) was built around.
- **Choreography** (an event-driven saga, where Order Service would publish something like `PaymentFailed` and Catalog Service would react by undoing its own reservation) was rejected. With only two participants, keeping the whole sequence and its compensation logic in one place — Order Service — is simpler to follow, test, and debug than spreading the rollback across event handlers in two services.
- **A dedicated saga-coordinator service** (a third service owning the "reserve, then commit or compensate" sequence) was also rejected: it would add a service, a deployment, and an extra network hop for a two-participant flow. The cost of keeping the orchestrator inside Order Service is that Order Service has to know Catalog Service's reserve/commit/rollback endpoints; if more participants were added, a choreographed saga or a separate coordinator would be worth revisiting.

**How to say it in an interview:** "It's an orchestrated saga where Order Service is the orchestrator. I chose that over choreography because with only two participants, keeping the compensation logic in one place is simpler than an event-driven rollback."

## Honest limit

Say this plainly if asked: the saga here is retried and idempotent, but it is **not self-healing past 3 attempts** — a sufficiently persistent Catalog Service outage during exactly the wrong window leaves inventory understated until someone manually reconciles it. That's a reasonable scope cut for a portfolio project's timeline, not a claim that this is production-grade fault tolerance.
