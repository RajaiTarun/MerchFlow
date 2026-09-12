# Product Requirements Document (PRD): Centralized College Merchandise Management System

**Document Version:** 1.0  
**Status:** Approved for Engineering Sprint  
**Target Architecture:** Polyglot Microservices with Event-Driven Communication  
**Estimated Sprint Timeline:** 7 to 9 Days (Prototype Scope)  

---

## 1. Executive Summary & Problem Statement

### 1.1 Current Background
Within our college ecosystem, student clubs independently launch and distribute custom merchandise (such as T-shirts, hoodies, caps, and mugs) throughout the academic year. Currently, this operational workflow is entirely decentralized: each club utilizes standalone forms, static size charts, and disparate spreadsheets to manage orders and track payments.

### 1.2 The Problem
This decentralized approach introduces significant friction across the campus ecosystem:
* **For Students:** They face repetitive data entry across multiple club forms, confusion regarding inconsistent sizing charts, and the complete absence of a centralized discovery portal to view active merchandise drops. Furthermore, high-demand "flash sales" frequently result in oversold inventory and manual order cancellations.
* **For Club Administrators:** Managing inventory counters, verifying payments, and coordinating campus delivery slots via manual spreadsheets leads to severe administrative overhead, human error, and poor order tracking.

### 1.3 The Solution
The **Centralized College Merchandise Management System** acts as a unified portal where all clubs can publish, showcase, and sell their merchandise. To elevate this project from a standard web application into a heavy-hitting system design showcase, the underlying architecture is engineered as a decoupled, polyglot microservices platform. It introduces automated sizing profile injection, high-concurrency inventory protection via distributed locks, distributed transaction rollbacks, and real-time event-driven delivery notifications.

---

## 2. Target Audience & User Personas

The system is architected to serve three distinct operational roles within the university ecosystem:

| Persona | Primary Goal | Key Pain Points Addressed | System Role & Permissions |
| :--- | :--- | :--- | :--- |
| **The Student** (`@students.iiit.ac.in`) | Discover club merchandise, checkout rapidly without re-entering size details, and secure limited-edition items without system crashes. | Repeated form filling, missed drops, sizing confusion, and inventory overselling during flash sales. | Standard authenticated access; can manage personal size profiles, browse catalogs, place orders, and view notifications. |
| **The Club Administrator** | Showcase merchandise to a wider student audience, enforce strict inventory limits during flash sales, and manage order distributions. | Spreadsheet chaos, manual inventory tracking, oversold orders, and chaotic campus distribution. | Admin access scoped to assigned club; can publish/update catalog items, set inventory thresholds, and broadcast delivery slots. |
| **The System Administrator (Super Admin)** | Onboard new clubs onto the platform and promote trusted students to administer them. | No self-service way for a club to get onto the platform without direct database access. | Universal root access; can look up any registered user by email, promote a user to `CLUB_ADMIN`, and create a new club while assigning that club's admin in the same action. Can also place orders like any other authenticated user. |

---

## 3. Core User Journeys & End-to-End Workflows

### 3.1 Journey 1: Student Onboarding & Saved Size Profile
This workflow eliminates repetitive data entry by allowing students to define a global sizing preference upon onboarding.

* **Registration:** A student navigates to the portal and registers using their official university email (`firstname.lastname@students.iiit.ac.in`).
* **Profile Construction:** The system utilizes the Builder Pattern to construct the user profile object, capturing contact details, campus address, and a "Global Preferred Size" (e.g., S, M, L, XL).
* **Relational Persistence:** The profile is saved in the PostgreSQL User Database, ensuring strict relational integrity and instant availability for future checkout payloads.

```
[Student] ---> Register (@students.iiit.ac.in) ---> [API Gateway]
                                                           |
                                                           v
[PostgreSQL User DB] <--- Save Profile & Size <--- [User & Auth Service]
```

### 3.2 Journey 2: Catalog Publishing & The "Flash Sale" Drop
This workflow empowers Club Admins to launch merchandise while protecting the backend against high-concurrency read/write spikes.

* **Publishing:** A Club Admin logs into their dashboard and publishes a new item (e.g., "Limited Edition Tech Club Hoodie") with flexible attributes (size, color, fabric weight) and a strict inventory cap of 50 units.
* **Document Persistence:** The item is stored in the MongoDB Catalog Database, leveraging a schema-less document structure to accommodate varying product attributes without Entity-Attribute-Value (EAV) complexity.
* **Feed Caching:** As soon as the item goes live, the Valkey Caching Layer caches the first page of the catalog feed.
* **Flash Sale Browsing:** Hundreds of students simultaneously browse the unified feed using cursor-based pagination. All read requests are served directly from memory via Valkey, shielding MongoDB from read exhaustion.

### 3.3 Journey 3: Order Placement, Size Injection & Out-of-Stock Fallback
This workflow streamlines order initiation while intelligently handling inventory edge cases.

* **Order Initiation:** A student clicks "Buy Now" on a merchandise listing.
* **Automated Size Injection:** The Order Service communicates with the User Service to automatically fetch and apply the student’s saved preferred size (e.g., Size: L).
* **Availability Evaluation & Fallback:**
  * **Scenario A (Preferred Size Available):** The system automatically locks in Size: L and proceeds directly to checkout confirmation.
  * **Scenario B (Out-of-Stock / Unreleased Size):** If Size: L is currently out of stock or not offered for this specific item, the system intercepts the automated flow, displays an immediate UI notification ("Your preferred size L is out of stock"), and prompts the student to manually select from remaining available sizes before allowing checkout progression.

### 3.4 Journey 4: High-Concurrency Checkout & Saga Rollback
This workflow represents the critical distributed systems mechanics during a checkout attempt, utilizing Magic Values to deterministically test resilience.

* **Idempotency Check:** The student submits the checkout form. The API Gateway checks the request header for an `Idempotency-Key`. If a duplicate submission is detected due to network lag, the request is intercepted and returned without double-charging.
* **Distributed Locking (Valkey):** The Order Service initiates a distributed lock on the specific merchandise item ID via Valkey. This isolates the row, ensuring that even if 500 students hit checkout at the exact same millisecond, only one concurrent thread can evaluate and deduct inventory at a time.
* **Inventory Hold:** The Catalog Service temporarily decrements the stock counter by 1.
* **Payment Simulation (Magic Values):** The system evaluates the input entered in the "Mock Card Number" field:

| Mock Card Input | Payment State | Triggered Backend Action & Distributed Workflow |
| :--- | :--- | :--- |
| `4242` | `200 OK` (Success) | The Order Service commits the transaction to PostgreSQL. The inventory deduction in MongoDB is marked as permanent. The Valkey distributed lock is released. An `OrderPlaced` event is published to RabbitMQ. |
| `4000` (or blank) | `400 Bad Request` (Failure) | The simulated payment fails. The Order Service aborts order creation. A Saga Compensating Transaction is triggered, firing an async rollback command to the Catalog Service to increment inventory back by 1. The Valkey lock is released. |

```
[Checkout Submission] ---> [Idempotency Check] ---> [Valkey Distributed Lock Acquired]
                                                                  |
                                                                  v
[PostgreSQL Order DB] <--- Payment Eval (4242 vs 4000) <--- [Hold Inventory (-1)]
        |                                                         |
  (Success: Commit)                                        (Failure: 4000)
        |                                                         |
        v                                                         v
[Publish 'OrderPlaced' Event]                     [Saga Rollback: Restore Stock (+1)]
```

### 3.5 Journey 5: Event-Driven Notifications & Circuit Breaking
This workflow demonstrates asynchronous decoupling and fault tolerance during notification dispatch.

* **Event Consumption:** When an order is successfully committed, the Notification Service consumes the `OrderPlaced` event from RabbitMQ.
* **Strategy Pattern Execution:** The service invokes the `NotificationStrategy` interface. Adhering to the Open/Closed Principle, the initial prototype executes the `InAppNotificationStrategy`, pushing real-time campus delivery and pickup time slots directly to the student’s portal dashboard.
* **Resilience & Circuit Breaking:** If the service attempts to trigger an external messaging channel (e.g., a simulated SMS provider) and experiences continuous timeouts or API errors, the integrated Circuit Breaker (Opossum) trips to the "Open" state. This stops further dispatch attempts instantly, preventing thread exhaustion, and relies on an exponential backoff Retry Pattern until system health recovers.

---

## 4. Key Performance Indicators (KPIs) & Success Metrics

To evaluate the success of the prototype from a systems engineering perspective, the following metrics will be tracked during load testing:

* **Zero Overselling Guarantee:** During a simulated 500-request flash sale drop for 50 items, the final inventory count in MongoDB must equal exactly 0, with exactly 50 committed orders in PostgreSQL and 450 cleanly rejected requests.
* **Lock Contention Latency:** Distributed lock acquisition and release via Valkey must complete within an average latency of `< 15ms` under high concurrency.
* **Saga Rollback Reliability:** 100% of simulated payment failures (`4000` magic value) must successfully trigger a compensating transaction that restores catalog inventory within `< 100ms`.
* **Cache Hit Ratio:** The Valkey caching layer must achieve a `> 85%` cache hit ratio for catalog feed browsing during peak traffic simulations.
* **Notification Decoupling:** Order Service API response times must remain completely unaffected (zero latency degradation) by the speed or state of the Notification Service.

---

## 5. Prototype Scope & System Boundaries (7–9 Day Sprint)

To ensure successful delivery within the 7 to 9-day development constraint while keeping daily debugging frictionless, the project boundaries are strictly defined into a two-phase execution model:

### 5.1 In-Scope Deliverables

* **Phase 1: Modular Local Development & Cloud Persistence:** Development and testing of all 5 independent microservices locally using standard Node.js port processes (orchestrated via `concurrently`). The data layer connects directly to free serverless cloud database endpoints (Neon/Supabase PostgreSQL, MongoDB Atlas, Upstash Valkey, and CloudAMQP RabbitMQ) to eliminate local OS memory overhead during logic development.
* **Phase 2: Final Docker Containerization Polish:** Once end-to-end distributed flows are verified, the entire 5-service architecture is containerized using individual `Dockerfile`s and orchestrated via a single root `docker-compose.yml` file for production-ready deployment and portfolio presentation.
* **Core Microservices:** Fully functional Node.js/Express API Gateway (with JWT authentication and rate limiting), User Service, Catalog Service, Order Service, and Notification Service running on isolated, modular service boundaries.
* **Distributed Concurrency & Resilience:** Implementation of Valkey distributed locks, Saga compensating transactions, idempotency enforcement, connection pooling (`pg-pool`), and Opossum circuit breakers.
* **Demonstration Frontend:** A lightweight, functional React web application designed specifically to trigger backend APIs and showcase the core user journeys (onboarding, browsing, automated sizing/fallback checkout, and in-app notifications).