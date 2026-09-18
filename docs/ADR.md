# Architecture Decision Records (ADRs)

**Project:** Centralized College Merchandise Management System 

**Document Version:** 1.0

**Status:** Approved for Engineering Sprint 

**Target Architecture:** Polyglot Microservices with Event-Driven Communication 

---

## Table of Contents

* **ADR-001:** Migration from Monolithic MERN Stack to Decoupled Microservices Architecture
* **ADR-002:** Polyglot Persistence Strategy (PostgreSQL vs. MongoDB)
* **ADR-003:** In-Memory Caching & Distributed Locking via Valkey (over Redis)
* **ADR-004:** Asynchronous Event-Driven Decoupling via RabbitMQ (over Apache Kafka)
* **ADR-005:** Distributed Transactions & Rollbacks via the Saga Pattern
* **ADR-006:** Fault Isolation & Resilience via Circuit Breaker and Retry Patterns

---

## ADR-001: Migration from Monolithic MERN Stack to Decoupled Microservices Architecture

### 1. Status

**Accepted** 

### 2. Context & Problem Statement

The initial technical specification proposed building the platform using a standard monolithic MERN stack (MongoDB, Express.js, React, Node.js). While a monolith simplifies initial local development, it introduces severe bottlenecks when scaling a campus-wide e-commerce platform:

* **High-Concurrency Vulnerability:** During limited-edition "flash sale" merchandise drops, intense traffic spikes on the catalog and checkout flows can consume all CPU and RAM resources, causing the entire application (including user authentication and background notifications) to crash.


* **Tight Coupling:** In a monolithic backend, an unhandled exception or memory leak in a non-critical module (such as delivery time slot broadcasting) can terminate the Node.js process, taking down critical order processing workflows.

### 3. Decision

We will abandon the monolithic architecture in favor of a **Decoupled Microservices Architecture**. The application layer will be divided into domain-driven, independently deployable Node.js/Express microservices fronted by an API Gateway:

* **API Gateway:** Handles centralized request routing, JSON Web Token (JWT) verification, and rate-limiting.


* **User & Auth Service:** Manages student identity, domain verification (`@students.iiit.ac.in`), and saved sizing profiles.


* **Merchandise Catalog Service:** Manages item listings, browsing feeds, and attribute queries.


* **Order & Checkout Service:** Executes checkout workflows, size preference injection, and financial transaction simulation.


* **Notification Service:** Dispatches asynchronous in-app delivery and distribution updates.



### 4. Consequences

#### Positive

* **Independent Scalability:** During flash sales, the Catalog and Order services can be scaled independently without allocating redundant compute resources to the Auth or Notification services.


* **Fault Isolation:** If the Notification Service fails or exhausts its thread pool, the Order Service and API Gateway remain fully operational.


* **Domain Modularity:** Enforces strict separation of concerns, making code easier to test, debug, and extend using dedicated architectural patterns.



#### Negative

* **Operational Complexity:** Requires multi-process management and explicit network routing—mitigated during local development by utilizing process orchestrators (e.g., concurrently across local ports 3000-3003) and standardized via Docker Compose during final containerized deployment.


* **Distributed Latency:** Network hops between the API Gateway, Order Service, and User Service introduce minor serialization overhead compared to in-memory function calls.



---

## ADR-002: Polyglot Persistence Strategy (PostgreSQL vs. MongoDB)

### 1. Status

**Accepted** 

### 2. Context & Problem Statement

Using a single database engine (such as MongoDB exclusively) across all microservices forces compromises between schema flexibility and transactional integrity:

* **The Catalog Problem:** Merchandise items possess wildly varying, unstructured attributes (e.g., apparel requires `size` and `fabric_weight`; mugs require `volume_ml`; notebooks require `paper_type`). In a relational database, modeling this requires cumbersome Entity-Attribute-Value (EAV) tables or complex `JSONB` querying.


* **The Checkout Problem:** Order processing, user identities, and financial records require strict relational integrity, Foreign Key constraints, and uncompromising ACID compliance. Under high-concurrency flash sales, document databases relying on optimistic snapshot isolation can generate high rates of `WriteConflict` transaction aborts, degrading checkout throughput.



### 3. Decision

We will implement a **Polyglot Persistence Strategy**, pairing specific database engines to the exact mechanical requirements of each microservice domain:

* **PostgreSQL (Relational Engine):** Assigned to the **User & Auth Service** and the **Order Service**. PostgreSQL provides native Multi-Version Concurrency Control (MVCC) and robust row-level locking (`SELECT ... FOR UPDATE`), queuing concurrent checkout requests predictably without data drift. All database connections will be managed via connection pooling (`pg-pool`) to minimize thread overhead.


* **MongoDB (NoSQL Document Engine):** Assigned to the **Merchandise Catalog Service**. MongoDB stores catalog items as natural, schema-less JSON documents, allowing dynamic product attributes to be indexed and queried without EAV overhead.



### 4. Consequences

#### Positive

* **Optimal Tooling:** Each service interacts with a storage engine optimized for its data structure—rigid transactional tables for orders vs. flexible documents for catalog inventory.


* **High-Contention Performance:** PostgreSQL natively handles simultaneous row lock requests during flash sales without throwing repetitive client-side write conflicts.



#### Negative

* **Cross-Engine Consistency:** The system cannot rely on native database foreign keys between orders (in PostgreSQL) and merchandise items (in MongoDB), requiring application-level orchestration.


* **Infrastructure Footprint:** Supporting two distinct database engines increases baseline system memory utilization if self-hosted locally—a constraint successfully mitigated during Phase 1 development by offloading data persistence to free serverless cloud tiers (Neon PostgreSQL and MongoDB Atlas).



---

## ADR-003: In-Memory Caching & Distributed Locking via Valkey (over Redis)

### 1. Status

**Accepted** 

### 2. Context & Problem Statement

To ensure high-performance catalog browsing and prevent overselling during flash sales, the architecture requires an in-memory key-value store for caching and distributed locking:

* **The Caching Need:** Serving the initial paginated feed of merchandise directly from disk-bound MongoDB during a 500-student traffic spike will degrade read latencies.


* **The Locking Need:** When multiple students attempt to purchase the last remaining units of an item simultaneously, race conditions can occur. The system must isolate inventory counters at the millisecond level so only one thread can evaluate and deduct stock at a time.


* **The Licensing Shift:** Earlier in 2024, Redis transitioned from its traditional open-source (BSD) license to a source-available license (RSALv2/SSPLv1).



### 3. Decision

We will adopt **Valkey**—the Linux Foundation's open-source, BSD-licensed fork of Redis—as our central in-memory data store:

* **Catalog Caching:** The Catalog Service will utilize Valkey to cache the first page of paginated merchandise feeds, serving read requests from memory to achieve a `> 85%` cache hit ratio and shield MongoDB from read exhaustion.


* **Distributed Locking:** The Order Service will implement distributed locks via Valkey. Upon checkout initiation, the backend will acquire a lock on the target item's inventory ID (`lock:item:{id}`). This guarantees mutually exclusive access to inventory deduction logic with target average latencies of `< 15ms`.


* **Why Valkey over Redis:** Swapping the `redis` Docker image for `valkey/valkey` maintains 100% command and client compatibility while aligning the portfolio project with modern open-source engineering standards.



### 4. Consequences

#### Positive

* **Zero Overselling Guarantee:** Eliminates race conditions during flash drops; excess concurrent requests fail cleanly once inventory hits zero without overdrawing stock.


* **Database Offloading:** Dramatically reduces read query pressure on MongoDB during high-traffic catalog browsing.


* **Industry Relevance:** Demonstrates proactive awareness of cloud infrastructure licensing shifts during technical interviews.



#### Negative

* **Lock Management Overhead:** Distributed locks require strict time-to-live (TTL) expiration policies and exception-handling try/finally blocks to ensure locks are released if a Node.js thread crashes unexpectedly.



---

## ADR-004: Asynchronous Event-Driven Decoupling via RabbitMQ (over Apache Kafka)

### 1. Status

**Accepted** 

### 2. Context & Problem Statement

When a student successfully places an order, the system must trigger delivery and distribution time slot updates.

* **The Synchronous Flaw:** If the Order Service executes a direct, synchronous HTTP/REST call to the Notification Service during checkout, any latency or downtime in the notification module directly delays or fails the student's checkout transaction.


* **Broker Selection:** The architecture requires an event-driven publish-subscribe broker to decouple these services. We evaluated **RabbitMQ** against **Apache Kafka**.



### 3. Decision

We will implement an **Event-Driven Architecture** utilizing **RabbitMQ** as our message broker:

* **Asynchronous Decoupling:** Upon committing a checkout transaction in PostgreSQL, the Order Service publishes an immutable `OrderPlaced` event payload to a RabbitMQ exchange and immediately returns a `200 OK` response to the user.


* **Consumer Isolation:** The standalone Notification Service subscribes to the RabbitMQ queue, consuming `OrderPlaced` events asynchronously and executing the `InAppNotificationStrategy` without blocking order fulfillment.


* **Why RabbitMQ over Kafka:** While Apache Kafka excels at massive, persistent log-stream processing, RabbitMQ is significantly lighter on CPU/RAM resources across both cloud-managed developer tiers (e.g., CloudAMQP) and containerized deployments. RabbitMQ provides native, lightweight routing for the Publish–Subscribe pattern required for delivery notifications at zero infrastructure cost.



### 4. Consequences

#### Positive

* **Zero Latency Degradation:** Order processing times remain completely unaffected by the speed or availability of the notification dispatch engine.


* **Buffer & Spike Smoothing:** If notification dispatches experience a burst of traffic, RabbitMQ safely buffers the events in queue until the consumer can process them.



#### Negative

* **Eventual Consistency in UI:** Students will see their order confirmation immediately upon checkout, but delivery notifications will appear on their dashboard asynchronously after a brief processing delay.



---

## ADR-005: Distributed Transactions & Rollbacks via the Saga Pattern

### 1. Status

**Accepted** 

### 2. Context & Problem Statement

In our polyglot architecture, a complete order placement requires modifying data across two distinct database engines:

1. Deducting the item stock counter by `1` in **MongoDB** (Catalog Service).


2. Creating the permanent order record and payment state in **PostgreSQL** (Order Service).



Because these databases do not share a unified transaction manager or two-phase commit (2PC) protocol, a partial failure creates data drift. For example, if inventory is decremented in MongoDB, but the simulated payment fails (e.g., the user inputs Magic Value `4000`), the system will leave inventory permanently reserved for a failed order.

### 3. Decision

We will implement the **Saga Pattern** using a choreography-based distributed transaction approach:

* **Forward Execution:** When checkout initiates, the Order Service acquires the Valkey lock and directs the Catalog Service to place a temporary hold (decrement) on the item inventory.


* **Transaction Evaluation:** The Order Service evaluates the mock payment input:


* **Success (`4242`):** The order commits to PostgreSQL, the inventory deduction in MongoDB is marked permanent, the Valkey lock releases, and the `OrderPlaced` event is published.


* **Failure (`4000` / Blank):** The payment fails (`400 Bad Request`). The Order Service aborts database insertion and automatically fires a **Compensating Transaction** command to the Catalog Service.




* **Compensating Rollback:** Upon receiving the rollback command, the Catalog Service increments the MongoDB inventory counter back by `1`, restoring stock within `< 100ms`, after which the Valkey lock is released.



### 4. Consequences

#### Positive

* **Cross-Service Data Integrity:** Guarantees eventual consistency across polyglot databases without using slow, blocking distributed locks across physical disks.


* **Resilience Testing:** Provides a deterministic, highly demonstrable mechanism to showcase enterprise error-handling and automated recovery during live demos.



#### Negative

* **Compensating Logic Overhead:** Requires writing and maintaining dual logic for every transactional step (both the forward action and its exact reverse rollback instruction).



---

## ADR-006: Fault Isolation & Resilience via Circuit Breaker and Retry Patterns

### 1. Status

**Accepted** 

### 2. Context & Problem Statement

The Notification Service is architected to utilize the Strategy Pattern (`NotificationStrategy`), allowing seamless future integration with third-party messaging providers (such as SendGrid for email or Twilio for WhatsApp).
If an external messaging API experiences an outage, severe network degradation, or rate-limiting, synchronous dispatch attempts will hang. Without fault isolation, continuous retries will exhaust the Node.js event loop and thread pool, cascading failures backward and consuming system memory.

### 3. Decision

We will implement the **Circuit Breaker Pattern** paired with an **Exponential Backoff Retry Pattern** within the Notification Service using the `Opossum` resilience library:

* **Circuit Breaker States:**
* **Closed (Normal):** Requests flow freely to the notification dispatch logic.


* **Open (Tripped):** If failure thresholds (e.g., continuous timeouts or `5xx` errors) exceed defined limits, the circuit breaker trips to "Open". All subsequent dispatch attempts fail fast instantly without executing network requests, preventing thread exhaustion.


* **Half-Open (Recovery):** After a cooldown period, the circuit lets a test request pass. If successful, the circuit closes; if it fails, it re-opens immediately.




* **Exponential Backoff:** For transient network instability, failed dispatches execute automated retries with exponentially increasing delay intervals before triggering the circuit breaker.



### 4. Consequences

#### Positive

* **Fail-Fast Stability:** Prevents external third-party outages from crashing internal campus microservices or draining server memory.


* **Resource Preservation:** Frees up CPU and networking threads immediately when upstream dependencies are unresponsive.



#### Negative

* **Tuning Complexity:** Requires careful configuration of failure percentages, timeout thresholds, and cooldown durations to prevent the breaker from tripping prematurely during temporary network blips.

**Revision note (2026-09-14):** this decision is still the intended design and its status below is unchanged — but it was never actually implemented. There is no `opossum` dependency in any service's `package.json`, and `services/notification-service/index.js` has no circuit-breaker or retry logic at all; its own inline comment says as much (`// retrying is not in my scope as of now, if i have time will try something like retry mechanism`). The Strategy-pattern seam this would attach to (`NotificationStrategy`) is real and already built (see `docs/system-design/LLD/design-patterns/strategy-observer-pattern.md`), and there's currently exactly one strategy (`InAppNotificationStrategy`, all-internal, nothing external to trip a breaker on) — so this becomes directly relevant the moment a real third-party channel (email/SMS) is added, not before. Treat ADR-006 as "designed, not yet built," not as a completed part of the system.

---

## Summary Matrix of Architecture Decisions

| ADR # | Decision Domain | Chosen Approach | Replaced / Rejected Alternative | Primary Justification |
| --- | --- | --- | --- | --- |
| **ADR-001** | System Architecture | **Decoupled Microservices** | Monolithic MERN Stack | Eliminates single-point-of-failure during flash sales; enables independent scaling.

 |
| **ADR-002** | Data Layer | **Polyglot Persistence (Postgres + Mongo)** | Pure MongoDB Monolith | Matches rigid ACID orders to relational tables and flexible catalog attributes to NoSQL documents.

 |
| **ADR-003** | Caching & Locking | **Valkey (In-Memory Data Store)** | Redis (Post-2024 License) | Fully open-source, BSD-licensed data store preventing inventory overselling via distributed locks.

 |
| **ADR-004** | Async Messaging | **RabbitMQ Message Broker** | Direct REST / Apache Kafka | Lightweight local container footprint; provides decoupled publish-subscribe delivery notifications.

 |
| **ADR-005** | Distributed Consistency | **Saga Pattern (Choreography)** | Two-Phase Commit (2PC) | Restores catalog inventory cleanly via compensating transactions if checkout payments fail.

 |
| **ADR-006** | Fault Isolation | **Opossum Circuit Breaker + Retries** | Unbounded Synchronous Retries | Fails fast during third-party API outages, preventing thread exhaustion and system crashes.

 |