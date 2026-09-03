# System Architecture

## High-level architecture

```text
Users
  |
  v
CloudFront
  |
  v
Next.js Web/PWA
  |
  +---- REST / WebSocket ----+
                             |
                             v
                       NestJS API
                             |
       +---------------------+----------------------+
       |                     |                      |
       v                     v                      v
   PostgreSQL              Redis                 S3
    + Prisma             + BullMQ              Files
       |
       +------------------+
                          |
                          v
                    Python Optimizer
                    + OR-Tools
```

## Backend modules

The API is a **modular monolith**. Domain modules are:

- Auth
- Company (tenant root)
- Organization (Branch, Department, Team)
- Employee
- Permissions (Role, Permission, Scope)
- Scheduling
- Attendance
- Leave
- Activities
- Documents
- Notifications
- Reports
- Billing
- Audit
- Super Admin

## Modular-monolith rules

1. Each module owns its domain logic.
2. Modules communicate through explicit application services and domain events.
3. Modules do not directly modify another module's tables without an approved domain boundary crossing.
4. Shared infrastructure is kept separate from domain modules.
5. Database transactions are used where domain consistency requires them.

## Asynchronous work

Use BullMQ for:

- notifications
- report generation
- scheduled reports
- document expiration reminders
- billing retries
- audit retention jobs
- schedule optimization requests (async fallback path — see ADR-006)
- offline-event reconciliation

## Outbox pattern

Important domain events must be written to an outbox in the same transaction as the state change. A worker publishes/processes the event after commit.

Example:

```text
DB transaction
  ├── update schedule
  └── create SchedulePublished outbox event
                 |
                 v
              Worker
          /      |          notification  audit  analytics
```

## Real-time (WebSocket)

Socket.IO is used for real-time events. WebSocket connections are tenant-scoped and server-authorized. Room assignment follows organizational scope (see ADR-007 in architecture-decisions.md).

Rooms:

```text
company:{companyId}
company:{companyId}:branch:{branchId}
company:{companyId}:department:{departmentId}
company:{companyId}:team:{teamId}
```

Individual user subscriptions also exist for personal notifications and optimization results.

## Schedule Optimization — Dual Path

See `architecture-decisions.md` ADR-006 for the full dual-path specification.

Summary:

- **Interactive path**: synchronous HTTP REST, NestJS → Python Optimizer, 30-second timeout.
- **Async fallback path**: BullMQ job, Python Optimizer worker, result stored in DB, manager notified via WebSocket + in-app notification.
