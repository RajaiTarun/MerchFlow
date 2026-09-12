# Requirements Specification: Centralized College Merchandise Management System

**Document Version:** 1.0  
**Target Architecture:** Microservices with Polyglot Persistence & Event-Driven Communication  
**Estimated Sprint Timeline:** 7 to 9 Days (Prototype Scope)  
**Primary Domain:** E-Commerce / Educational Technology  

---

## 1. Executive Summary & Problem Statement

Currently, college clubs manage merchandise sales in silos using disparate forms and size charts. As a result, students face repeated data entry, confusing sizing formats, and the absence of a unified catalog to view available items. Meanwhile, club managers lack a structured way to showcase items and manage orders.

The **Centralized College Merchandise Management System** acts as a unified portal solving these operational bottlenecks. To elevate this engineering prototype into an advanced backend system design showcase, the architecture replaces a monolithic MERN setup with decoupled microservices, polyglot databases, distributed concurrency controls, and fault-tolerant communication patterns.

---

## 2. Stakeholders & User Personas

- **The Student:** Wants a streamlined purchasing experience where they can browse all college club merchandise in one portal, save their preferred sizing profile once, and securely purchase limited-edition drops without system crashes.
- **The Club Administrator:** Needs a structured dashboard to publish merchandise items with varying attributes, set strict inventory limits, and manage student orders efficiently.
- **The System Administrator (Super Admin):** Acts as the universal controller of the entire platform with full system-wide permissions. Has the authority to look up any registered user by email, promote a user to `CLUB_ADMIN`, and create new clubs — assigning each new club's admin in the same action. Also retains every permission a Club Admin or Student has (including placing orders).



---

## 3. Functional Requirements (FRs)

### FR1: User & Authentication Service
* **FR1.1 — Domain-Restricted Registration:** The system must restrict account registration strictly to users possessing a valid university email address matching the format `firstname.lastname@students.iiit.ac.in`.
* **FR1.2 — Authentication Strategy:** The system must authenticate users via an email and hashed password mechanism, issuing JSON Web Tokens (JWT) through an API Gateway for session management.
* **FR1.3 — Saved Size Profile:** Authenticated students must be able to create and update a preferred global size profile (e.g., S, M, L, XL) stored in a relational database.
* **FR1.4 — Role-Based Access Control (RBAC):** The system must enforce RBAC to differentiate system permissions between standard Student accounts and authorized Club Admin accounts.
* **FR1.5 — Builder Pattern Integration:** The system must utilize the Builder Pattern for the step-by-step construction of complex student profile objects containing attributes such as name, contact details, address, and saved sizes.

### FR2: Merchandise Catalog Service
* **FR2.1 — Merchandise Publishing:** Club Administrators must be able to create, list, and update merchandise listings through a dedicated management interface.
* **FR2.2 — Flexible Attribute Support:** The catalog must support dynamic, varying item attributes (e.g., size and color for apparel; volume for mugs; paper type for notebooks) without schema constraints.
* **FR2.3 — Unified Browsing Feed:** Students must be able to browse and compare available merchandise from multiple clubs through a single, unified catalog feed.
* **FR2.4 — Factory Pattern Integration:** The service must implement the Factory Pattern via a centralized creation method to instantiate distinct merchandise objects (e.g., T-shirts, hoodies, caps, mugs) without direct object instantiation across the codebase.

### FR3: Order & Checkout Service
* **FR3.1 — Automated Size Injection:** When placing an order, the system must automatically fetch and apply the student’s pre-saved size profile to streamline checkout.**Out-of-Stock Fallback:** If the student's pre-saved preferred size is currently out of stock, not offered for that specific merchandise item, or unreleased, the system must gracefully intercept the automated selection, display a notification regarding size unavailability, and prompt the user to manually select from the remaining available sizes before allowing checkout progression.
* **FR3.2 — Checkout Idempotency:** The checkout API must require an `Idempotency-Key` in the request header to guarantee that network lag or duplicate button clicks result in only a single processed order and payment charge.
* **FR3.3 — Command Pattern Integration:** The system must implement the Command Pattern to encapsulate actions such as placing an order, canceling an order, or updating delivery slots as discrete command objects.
* **FR3.4 — Simulated Payment Gateway (Magic Values):** The checkout flow must integrate a mock payment service utilizing specific card number input rules ("Magic Values") to deterministically test transaction states:

| Input Field (Mock Card) | Triggered System State | Expected Backend Action |
| :--- | :--- | :--- |
| `4242` | `200 OK` (Payment Success) | Commit order to database, permanently deduct inventory, and publish `OrderPlaced` event. |
| `4000` (or blank) | `400 Bad Request` (Payment Failure) | Abort order creation, trigger compensating Saga rollback, and release Valkey inventory lock. |

### FR4: Notification Service
* **FR4.1 — Asynchronous Delivery Updates:** Upon successful order placement, the system must asynchronously generate real-time updates regarding upcoming campus delivery and distribution time slots.
* **FR4.2 — Observer Pattern Integration:** The system must use the Observer Pattern so that all subscribed students automatically receive notifications when order confirmations or distribution schedule announcements occur.
* **FR4.3 — Strategy Pattern for Channels:** The service must implement the Strategy Pattern (`NotificationStrategy`), keeping initial sprint delivery restricted to an `InAppNotificationStrategy` while ensuring adherence to the Open/Closed Principle for future `EmailStrategy` or `WhatsAppStrategy` integration.

### FR5: Super Admin Administration

A basic, functional administration capability for the Super Admin — application-level administration only. This explicitly does **not** include infrastructure diagnostics (circuit-breaker status, aggregated microservice health, database connection-pool or message-queue monitoring); an earlier revision of this specification included that scope and it has been removed.

* **FR5.1 — User Lookup by Email:** The Super Admin must be able to find an existing user by their exact email address and view their basic, non-sensitive account details (name, current role, current club). This is a minimal exact-match lookup, not a searchable/paginated user directory.
* **FR5.2 — Role Promotion to Club Admin:** The Super Admin must be able to promote an existing user (identified via FR5.1) to `CLUB_ADMIN`. A user already assigned to a club must be demoted before being promoted to administer a different one.
* **FR5.3 — Club Creation with Admin Assignment:** The Super Admin must be able to create a new club, identifying its Club Admin by email in the same request. Club creation and admin assignment must be transactional — if either step fails, neither is committed. Clubs are therefore not permanently fixed/pre-seeded data.

---

## 4. Non-Functional Requirements (NFRs)

### NFR1: Concurrency & Data Integrity (The "Flash Sale" Requirement)
* **NFR1.1 — Zero Overselling Guarantee:** The system must guarantee that merchandise inventory is never oversold during high-traffic "flash sale" drops (e.g., 500 students simultaneously attempting to purchase 50 limited-edition hoodies).
* **NFR1.2 — Distributed Locking:** The system must implement Distributed Locks using Valkey to isolate item inventory IDs, ensuring only one concurrent thread can execute stock modifications at any given millisecond.
* **NFR1.3 — Database-Level Locking:** For relational transactions, the system must support explicit locking strategies (e.g., Pessimistic / Optimistic locking via native MVCC and row-level locking in PostgreSQL) to queue high-contention checkout requests predictably.
* **NFR1.4 — ACID Compliance:** All order creation, user profile modifications, and financial transaction records must adhere strictly to ACID properties.

### NFR2: Distributed System Resilience
* **NFR2.1 — Distributed Transactions (Saga Pattern):** The system must implement the Saga Pattern across the Order and Catalog microservices. If an inventory hold succeeds in the Catalog Service but payment processing fails in the Order Service, the system must automatically execute a compensating transaction to restore catalog inventory.
* **NFR2.2 — Fault Isolation (Circuit Breaker Pattern):** The Notification Service must implement the Circuit Breaker Pattern using a circuit-breaking library (such as Opossum in Node.js). If simulated external messaging APIs fail continuously, the circuit must trip to open, failing fast to prevent thread exhaustion and cascading system crashes.
* **NFR2.3 — Transient Error Handling:** All inter-service network communication and external API calls must implement a Retry Pattern utilizing exponential backoff for handling temporary network instability.
* **NFR2.4 — Service Discovery & Health Monitoring:** All microservices and the API Gateway must expose dedicated `/health` endpoints to allow load balancers and orchestrators to execute heartbeat monitoring and node liveness checks.

### NFR3: Performance & Scalability
* **NFR3.1 — In-Memory Catalog Caching:** The system must utilize Valkey as an in-memory caching layer to serve the first page of merchandise catalog results, significantly reducing read query overhead on the primary database during traffic spikes.
* **NFR3.2 — Cursor-Based Pagination:** The Merchandise Catalog Service must implement cursor-based pagination for catalog browsing instead of standard offset pagination to eliminate performance degradation over large datasets.
* **NFR3.3 — Database Connection Pooling:** The relational data layer must utilize connection pooling (e.g., `pg-pool` for PostgreSQL) to minimize connection overhead and efficiently manage thread counts under load.
* **NFR3.4 — Asynchronous Event Decoupling:** Cross-service communication for non-blocking operations (such as triggering delivery notifications) must be fully decoupled using a Publish–Subscribe Pattern backed by a message broker (RabbitMQ), ensuring checkout API latency is unaffected by notification processing.

### NFR4: Maintainability & Architecture
* **NFR4.1 — Microservices Modularity:** The application layer must be divided into distinct, independently deployable microservices based on business domains: API Gateway, User/Auth Service, Catalog Service, Order Service, and Notification Service.
* **NFR4.2 — Polyglot Persistence Strategy:** The data layer must implement polyglot persistence to match database engines to specific data characteristics:
  * **PostgreSQL:** Used for Users, Clubs, and Orders to ensure strict relational schema integrity and ACID compliance.
  * **MongoDB:** Used for the Merchandise Catalog to support flexible, unstructured JSON document schemas for varying product attributes without Entity-Attribute-Value (EAV) overhead.
* **NFR4.3 — Repository Pattern Integration:** Database operations across all services must be abstracted using the Repository Pattern, providing dedicated repositories for entities (users, orders, items, notifications) to simplify maintenance and testing.

---

## 5. Prototype Scope & System Boundaries (7–9 Day Sprint)

To ensure successful delivery of the distributed systems architecture within the 7 to 9-day development constraint while keeping daily debugging frictionless, the following two-phase execution boundaries are established:

### Included in Sprint Scope

* **Phase 1: Modular Local Development & Cloud Persistence:** Development and testing of all 5 independent microservices locally using Node.js port processes (orchestrated via `concurrently`). The data layer connects directly to free serverless cloud database endpoints (Neon/Supabase PostgreSQL, MongoDB Atlas, Upstash Valkey, and CloudAMQP RabbitMQ) to eliminate local OS memory overhead during logic development.
* **Phase 2: Final Docker Containerization Polish:** Once end-to-end distributed flows are verified, the entire 5-service architecture is containerized using individual `Dockerfile`s and orchestrated via a single root `docker-compose.yml` file for production-ready deployment and portfolio presentation.
* **Core Microservices & Routing:** Fully functional Node.js/Express API Gateway (with JWT auth and rate limiting), User Service, Catalog Service, Order Service, and Notification Service running on isolated, modular service boundaries.
* **End-to-End Concurrency & Resilience Flows:** Demonstration of Valkey distributed locking during simulated flash sales, Saga compensating transactions on checkout failures, and RabbitMQ event publication.
* **Lightweight Demonstration UI:** Bare-bones React frontend solely engineered to trigger backend APIs and demonstrate the three end-to-end user journeys: browsing, ordering with saved sizes, and viewing in-app delivery notifications.