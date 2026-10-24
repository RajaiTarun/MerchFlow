# Request Lifecycle: Checkout

This is the most interview-relevant diagram in the repo. It's the one flow that touches almost every distributed-systems mechanism in the project in a single request: idempotency, the lock, the saga, three services, and one message broker. It's built directly from `services/order-service/routes/orders.js`, `POST /` (L77-L495); line references point there unless noted.

The client reaches Order Service through the gateway, which first verifies the JWT, applies the orders rate limiter, and attaches the internal key. Those gateway steps are left out of the diagrams below.

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
    participant NS as Notification Service

    C->>O: POST /orders {catalogItemId, quantity, mockCardNumber: "4242", selectedSize?}<br/>header: Idempotency-Key
    O->>V: GET idempotency:order:{key}
    V-->>O: (empty)
    O->>V: SET idempotency:order:{key} PROCESSING, EX 24h, NX
    V-->>O: OK
    O->>U: GET /profile/:userId (internal)
    U-->>O: preferred_size
    O->>Cat: GET /:catalogItemId (internal)
    Cat-->>O: item {availableSizes, clubId, name}
    Note over O: resolve size: selectedSize if sent, else preferred_size,<br/>validated against availableSizes (400 + availableSizes if not offered)
    O->>V: SET lock:item:{id} token NX PX 15000
    V-->>O: OK (lock acquired)
    O->>Cat: PATCH /:id/stock {quantity, reservationId = idempotencyKey}
    Note over Cat: one Mongo transaction:<br/>skip if reservationId already used,<br/>findOneAndUpdate stock -= qty WHERE stock >= qty,<br/>insert InventoryReservation
    Cat-->>O: 200 {item with decremented stock}
    Note over O: mockCardNumber === "4242" → status = COMMITTED
    O->>PG: INSERT INTO orders (..., student_email, item_name)
    PG-->>O: order row
    O->>Cat: PATCH /:id/reservation/commit {reservationId}
    Cat-->>O: 200 (reservation marked COMMITTED)
    O-)MQ: publish order.placed (fire-and-forget, not awaited)
    O->>V: SET idempotency key SUCCESS + cached response, EX 24h
    O-->>C: 201 {order}
    Note over O: finally block runs after the response:
    O->>V: release lock:item:{id} (Lua script, token-checked)
    MQ-)NS: order.placed (consumed asynchronously)
```

## The failure path (`mockCardNumber` anything other than `"4242"`, e.g. `"4000"` or blank)

Everything up to the stock reservation is identical. The paths diverge right after `PATCH /:id/stock` succeeds. The code deliberately reserves stock *before* evaluating payment, which is exactly what makes a compensating transaction necessary.

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
    O-->>C: 400 {error: "PAYMENT_FAILED"}
    Note over O: finally block runs after the response:
    O->>V: release lock:item:{id} (Lua script, token-checked)
```

## The other early exits

| Where | Response | What else happens |
|---|---|---|
| No `Idempotency-Key` header | `400` | Nothing touched |
| Key already `SUCCESS` | `200` + the cached response | No new order |
| Key still `PROCESSING` (a duplicate in flight) | `409` | Nothing touched |
| Valkey unreachable during the idempotency check | `503` | Nothing touched |
| Size not offered / no preferred size saved | `400` + `availableSizes` | Idempotency key cleared |
| Lock held by another checkout | `409 LOCK_CONTENTION_DETECTED`, `Retry-After: 1` | Idempotency key cleared. The frontend retries with the same key. |
| Not enough stock | `409 OUT_OF_STOCK` | Nothing was reserved, so there's no compensation. Key cleared, lock released. |

Three things about this flow that are easy to get wrong when explaining it from memory:

- **The lock is released in a `finally` block** (L486-L493). It runs whether the request succeeds, fails at payment, or fails at any earlier step after the lock was taken. There's exactly one place the lock is released, not one per exit path. Because `return res…` executes before `finally`, the client gets its response slightly before the lock is released.
- **Idempotency and locking solve different problems, at different points.**
  - The idempotency check happens *before* the lock is even attempted, so a retried request with the same key never re-enters the flow.
  - The lock is scoped to the *item*, not the request. Two students checking out the same item both pass the idempotency check (their keys differ), but only one gets the lock.
  - See [idempotency.md](../LLD/concurrency-control/idempotency.md) for the sharp version of this distinction.
- **A failed compensation doesn't roll anything back further.** If all 3 rollback attempts fail, the code logs `CRITICAL` and returns `400` anyway. The student correctly sees "payment failed", but the stock count is understated until someone intervenes manually. This is an acknowledged gap, not a hidden one; see [saga-rollback.md](../LLD/saga-and-compensation/saga-rollback.md).
