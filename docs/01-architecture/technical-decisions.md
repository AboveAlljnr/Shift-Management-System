# Technical Decisions

| Decision | Choice | Reason |
|---|---|---|
| Application architecture | Modular monolith | Lower V1 operational complexity; microservices-ready interfaces |
| Tenant model | Company (not Tenant) | Canonical domain terminology — see ADR-001 |
| Identity model | User + CompanyMembership + Employee | Separates authentication, access, and workforce identity — see ADR-002 |
| Primary DB | PostgreSQL | Strong relational consistency and multi-tenant foreign key enforcement |
| ORM | Prisma | Type safety, productivity, and migration management |
| Async jobs | Redis + BullMQ | Mature queue model with retry, backoff, and monitoring |
| Files | S3-compatible | Durable object storage; paths include companyId prefix |
| Optimization | Python + OR-Tools | Constraint optimization fit; isolated compute characteristics |
| Optimizer integration | Dual-path: sync HTTP (30s) + async BullMQ fallback | Optimizes for interactive UX without sacrificing long-running jobs — see ADR-006 |
| LLM | Separate assistant layer in NestJS | Keeps deterministic rules authoritative; LLM handles explanation only |
| Authorization | Hierarchical scope (Company→Branch→Department→Team) | Business requirement for manager scoping — see ADR-003 |
| WebSocket tenancy | Server-controlled room assignment with companyId prefix | Prevents cross-company data leakage — see ADR-007 |
| Billing unit | Active Employee count | Business requirement; independent of authentication accounts — see ADR-008 |
| Session strategy | JWT (15 min) + hashed refresh token in PostgreSQL (7 days) | Allows token revocation without Redis session store |
| 2FA | TOTP (RFC 6238), optional per company | Standard, app-agnostic; no SMS dependency in V1 |
| Production compute | ECS/Fargate | Avoid premature Kubernetes |
| API | REST/OpenAPI | Simple and integration-friendly |
| Mobile | Responsive PWA | One workforce client for V1 |
| Conflict overrides | Dedicated ShiftConflictOverride entity | Auditability; AI cannot bypass hard constraints — see ADR-005 |

## Non-negotiable principles

1. The deterministic scheduling/conflict engine is authoritative. AI cannot bypass hard business constraints.
2. `Company` is the tenant root entity. `Tenant` is never introduced as a domain entity.
3. `User`, `CompanyMembership`, and `Employee` are distinct concepts and must not be conflated.
4. Scope checks are centralized in `AuthorizationService` — never duplicated in individual controllers.
