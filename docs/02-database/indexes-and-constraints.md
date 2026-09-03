# Indexes and Constraints

## Required indexes

### Identity and access
- `users.email` — UNIQUE
- `company_memberships(userId, companyId)` — UNIQUE
- `refresh_tokens.tokenHash` — UNIQUE
- `refresh_tokens(userId)` — lookup by user for revocation
- `companies.slug` — UNIQUE

### Employees and organization
- `employees(companyId, employeeNumber)` — UNIQUE
- `employees(companyId, status)` — filter active employees for billing
- `employees(companyId, userId)` — reverse lookup from User to Employee
- `branches(companyId)`, `departments(companyId)`, `teams(companyId)` — tenant filtering
- `positions(companyId, code)` — UNIQUE

### Authorization
- `access_scopes(membershipId, scopeType, scopeId)` — composite for scope resolution
- `user_roles(membershipId)`, `role_permissions(roleId)` — permission evaluation chain

### Scheduling
- `shifts(companyId, startAt)` — date range queries
- `shifts(companyId, branchId, startAt)` — branch schedule queries
- `shifts(companyId, status)` — filtering by lifecycle state
- `shift_assignments(employeeId, shiftId)` — UNIQUE; also lookup by employee
- `shift_conflict_overrides(shiftId, employeeId)` — lookup overrides for a shift
- `optimization_requests.idempotencyKey` — UNIQUE

### Attendance
- `attendance_records(employeeId, workDate)` — UNIQUE; primary lookup
- `attendance_records(companyId, workDate)` — daily attendance overview
- `attendance_events(employeeId, clientOccurredAt)` — chronological event stream
- `attendance_events.idempotencyKey` — UNIQUE (offline sync deduplication)

### Leave
- `leave_requests(companyId, status, startDate)` — manager approval queue
- `leave_balances(employeeId, leaveTypeId, year)` — UNIQUE

### Documents
- `documents(employeeId, expiresAt)` — expiry reminders
- `documents(companyId, status)` — company document overview

### Notifications
- `notifications(recipientId, isRead, createdAt)` — unread inbox query

### Billing
- `subscriptions.companyId` — UNIQUE (one subscription per company)
- `provider_webhook_events(provider, eventId)` — UNIQUE (idempotency)

### Audit and outbox
- `audit_logs(companyId, occurredAt)` — compliance queries
- `audit_logs(resource, resourceId)` — resource-specific audit history
- `outbox_events(status, createdAt)` — worker pickup queue

---

## Constraints

### Database-enforced

- NOT NULL on all required fields
- UNIQUE constraints as listed above
- Foreign keys on all relationship columns
- CHECK constraints on:
  - valid status enum values where not enforced by ORM/application
  - positive durations and headcounts (shift requirements: headcount >= 1)
  - valid date ranges (startDate <= endDate, startAt < endAt)
  - shift assignment uniqueness: one employee per shift
  - leave balance: used + pending <= entitlement (enforced at application layer with DB constraint as backstop)

### Application-layer only (cannot be efficiently expressed in SQL)

- Scheduling conflict rules (overlap, rest period, max hours, availability, leave)
- Cross-branch staffing authorization (see Open Decision OD-002)
- Scope inheritance resolution
- Billing seat limit enforcement (soft block with admin warning by default)

### Append-only tables (no UPDATE or DELETE)

The following tables must never be updated or deleted from — enforced by application convention and ideally by PostgreSQL triggers or RLS in a hardening phase:

- `attendance_events`
- `shift_conflict_overrides`
- `shift_history`
- `attendance_corrections`
- `billing_events`
- `audit_logs`
- `outbox_events`
- `provider_webhook_events`

### Deletion behavior

| Table | On parent delete |
|---|---|
| `employees` | Soft-delete (status = terminated); historical data preserved |
| `company_memberships` | Set `status = revoked`; preserve for audit |
| `shift_assignments` | Cascade delete when shift is hard-deleted (shift drafts only); soft-cancel for published |
| `documents` | Soft-delete (status = revoked); preserve DocumentVersion records |
| `notifications` | Retain for notification history; soft-delete allowed |
| `audit_logs`, `outbox_events` | Never deleted in V1; retention policy in V2 |
