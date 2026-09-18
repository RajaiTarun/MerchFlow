# Request Lifecycle: Checkout

This is the single most interview-relevant diagram in the repo — it's the one flow that touches almost every distributed-systems mechanism in the project (lock, idempotency, saga, three services, one message broker) in one request. It's built directly from `services/order-service/routes/orders.js`, `POST /` — line references below point there unless noted.

## The success path (`mockCardNumber: "4242"`)

```mermaid
sequenceDiagram
    participant C as Client
    participant O as Order Service
    participant V as Valkey
    participant U as User Service
    participant Cat as Catalog Service
    participant PG as Postgres (orders)
    participant MQ as RabbitMQ

    C->>O: POST /orders {catalogItemId, mockCardNumber: "4242"}<br/>header: Idempotency-Key
    O->>V: GET idempotency:order:{key}
    V-->>O: (empty)
    O->>V: SET idempotency:order:{key} PROCESSING, EX 24h, NX
    V-->>O: OK
    O->>U: GET /profile/:userId (internal)
    U-->>O: preferred_size
    O->>Cat: GET /:catalogItemId (internal)
    Cat-->>O: item {availableSizes, clubId, name}
    Note over O: resolve size: selectedSize override, else preferred_size,<br/>validated against availableSizes
    O->>V: SET lock:item:{id} token NX PX 15000
    V-->>O: OK (lock acquired)
    O->>Cat: PATCH /:id/stock {quantity, reservationId=idempotencyKey}
    Note over Cat: atomic Mongo transaction:<br/>check reservationId not already used,<br/>findOneAndUpdate stock -= qty WHERE stock >= qty,<br/>insert InventoryReservation
    Cat-->>O: 200 {item with decremented stock}
    Note over O: mockCardNumber === "4242" → status = COMMITTED
    O->>PG: INSERT INTO orders (..., student_email, item_name)
    PG-->>O: order row
    O->>Cat: PATCH /:id/reservation/commit {reservationId}
    Cat-->>O: 200 (reservation marked COMMITTED)
    O->>MQ: publish order.placed (fire-and-forget, not awaited)
    O->>V: SET idempotency key SUCCESS + cached response, EX 24h
    O->>V: DEL lock:item:{id} (via Lua script, token-checked)
    O-->>C: 201 {order}
    MQ->>NS: consume order.placed (async, separate process)
```

## The failure path (`mockCardNumber: "4000"` or blank)

Everything up to the stock reservation is identical. The divergence happens right after `PATCH /:id/stock` succeeds — the code deliberately reserves stock *before* evaluating payment, which is exactly what makes a compensating transaction necessary at all.

```mermaid
sequenceDiagram
    participant C as Client
    participant O as Order Service
    participant V as Valkey
    participant Cat as Catalog Service

    Note over O: (lock acquired, stock already reserved — same as success path)
    O->>O: mockCardNumber !== "4242" → throw new Error('PAYMENT_FAILED')
    Note over O: catch block: inventoryReserved === true, so compensation runs
    loop up to 3 attempts, 100ms then 200ms backoff
        O->>Cat: PATCH /:id/rollback {reservationId}
        alt rollback succeeds
            Note over Cat: idempotent — checks InventoryCompensation first —<br/>findOneAndUpdate stock += qty, marks reservation COMPENSATED
            Cat-->>O: 200 {alreadyCompensated: false}
        else transient failure (network, timeout)
            Cat--xO: error
        end
    end
    Note over O: if all 3 attempts fail: logged as CRITICAL,<br/>no further automated recovery — see saga-rollback.md
    O->>V: DEL idempotency:order:{key} (cleared, not marked SUCCESS)
    O->>V: DEL lock:item:{id} (finally block — always runs, success or failure)
    O-->>C: 400 {error: "PAYMENT_FAILED"}
```

Three things about this flow that are easy to get wrong when explaining it from memory:

- **The lock is released in a `finally` block**, so it's released whether the request succeeds, fails at payment, or fails at any earlier step (`orders.js` lines ~478–485). This is what makes the lock safe to reason about — there's exactly one place it's released, not one per exit path.
- **Idempotency and locking are solving different problems and are checked at different points.** The idempotency check happens *before* the lock is even attempted (a retried request with the same key should never re-enter the flow at all). The lock is scoped to the *item*, not the request — two different students checking out the same item both pass the idempotency check (different keys) but only one gets the lock. See [idempotency.md](../LLD/concurrency-control/idempotency.md) for the sharp version of this distinction.
- **A failed compensation doesn't roll anything back further.** If all 3 rollback attempts fail, the code logs `CRITICAL` and returns `400` to the client anyway — the student correctly sees "payment failed," but the inventory count is now wrong until someone intervenes manually. This is a real, acknowledged gap, not a hidden one — see [saga-rollback.md](../LLD/saga-and-compensation/saga-rollback.md).
