# MVP Scope

> **V1 is the long-term architecture. MVP is the currently active implementation scope.**
> This document defines exactly what the MVP delivers. It is a strict subset of the V1
> architecture described throughout `/docs`. V1 models, migrations, and deferred modules
> are preserved and are **not** deleted or redesigned.

## 1. MVP Product Promise

> A company can organize its workforce, create schedules, assign employees to shifts,
> and track attendance.

The MVP is a production-quality core workflow: **authentication → organization →
workforce → scheduling (with conflict detection) → attendance → leave → dashboard**,
delivered as a responsive web/PWA.

## 2. MVP In-Scope Product Areas

### 2.1 Foundation
- Monorepo build (pnpm + turbo), type-check, lint, tests, build.
- Database schema + **controlled migrations** and **seed**.
- Logging, audit subsystem (append-only `AuditLog`).
- API conventions (`/api/v1`, JSON envelope `{ data, message }`, error envelope, pagination).

### 2.2 Authentication & Authorization
- Registration (company + owner), login, logout, access tokens (JWT, 15 min), refresh
  tokens (hashed, rotated, individually revocable).
- Password security (bcrypt), account lockout (Redis), basic session management.
- Identity model (LOCKED, ADR-002):
  ```
  User  +-- CompanyMembership --> Company
   |
   +-- Employee (company-scoped, optionally linked to User)
  ```
  **Never** fall back to `User.companyId`. `User`, `CompanyMembership`, and `Employee`
  remain distinct concepts.
- CompanyMembership, roles, permissions, hierarchical organizational scopes, tenant isolation.
- Authorization hierarchy (ADR-003, LOCKED, downward-only):
  ```
  Company -> Branch -> Department -> Team -> Self
  ```
  Parent scope grants access downward only; **never upward or sideways**.
- Centralized authorization (`AuthorizationService` + global guards); controllers never
  implement their own scope checks. Deny-by-default.

### 2.3 Company & Organization
- Company (tenant root), Branches, Departments, Teams.
- All tenant data isolated by `companyId`. Org hierarchy enforced.
- Managers access only authorized organizational scopes.
- Employment types, Positions, Skills, Certifications (as required to support scheduling
  requirements and employee profiles).
- Audit of org changes.

### 2.4 Employees
- Employee creation, editing, viewing, activation/deactivation.
- Employment status, position, branch, department, team, basic employee information.
- Optional linked `User` account (auth identity and workforce profile kept separate).
- Employee numbers unique per company; tenant-FK integrity on all assignments
  (branch/department/team/position must resolve within the same company).

### 2.5 Availability
- Availability rules and exceptions used by the scheduling conflict engine.

### 2.6 Leave
- Leave types, leave requests, approval/rejection, leave status.
- Basic leave balances (as required by schema).
- **Approved leave blocks scheduling** (`APPROVED_LEAVE` = BLOCKING conflict).

### 2.7 Scheduling
- Create / edit / cancel shifts, assign employees, remove assignments.
- Recurring shifts, overnight shifts, shift notes, basic staffing requirements
  (headcount/position/skills/certifications).
- Schedule calendar, schedule publishing (versioned, immutable snapshots).
- Schedule history/versioning (immutable `ShiftHistory`).
- **Deterministic conflict engine** (authoritative; AI cannot bypass).

### 2.8 Scheduling Conflict Engine
- Hard checks: overlapping shifts, availability conflicts, approved leave, minimum rest,
  maximum working hours, position eligibility, required skills/certifications, basic
  staffing coverage.
- Structured conflicts:
  ```
  Conflict { type, severity, employeeId, shiftId, relatedShiftId, ruleIdentifier, message, overrideAllowed, metadata }
  ```
- Only **WARNING**-severity conflicts are overridable; **BLOCKING** never is. Overrides
  require `shift.conflict_override` permission and a non-empty reason; overrides are
  append-only and audited (`ShiftConflictOverride` + `AuditLog`).

### 2.9 Attendance
- Clock in, clock out, break start, break end.
- Attendance history, attendance status (full status set from V1).
- Manager correction, manager override where authorized.
- **Immutable attendance events** (`AttendanceEvent`), normalized `AttendanceRecord`.
- **Idempotency protection** via unique `idempotencyKey`.
- No advanced continuous location tracking.

### 2.10 Basic Dashboard
- Role-aware dashboard.
- Employee view: today's shift, upcoming shifts, attendance status, leave status.
- Manager view: today's workforce, today's shifts, attendance status, upcoming shifts,
  pending leave requests, staffing/conflict warnings.
- No advanced analytics.

### 2.11 Responsive Web/PWA
- Works on desktop, tablet, and mobile; workforce/attendance experience prioritized for mobile.
- Use the existing PWA foundation.
- No advanced native mobile functionality.

## 3. Explicitly DEFERRED FROM MVP

The following remain on the **V1 roadmap** and are **not** MVP requirements. Their database
models (already in the V1 architecture) are preserved and **not** deleted. Their UI/workflows
are not implemented unless required by an MVP dependency.

```text
AI scheduling / OR-Tools integration (backend proposal endpoint only when MVP depends on it)
Billing / subscriptions / payments            (keep read-only subscription view + plans)
Advanced reports
Advanced exports
Documents
Announcements
Advanced notifications
Advanced activities/training
Advanced GPS/geofencing
Complex offline synchronization
Open shift marketplace
Advanced shift swaps
Advanced analytics
External integrations
Public API
Webhooks (processing only; keep idempotent ingestion)
Payroll integrations
Calendar integrations
Attendance device integrations
Native mobile apps
Advanced Super Admin
Advanced white-listing
Advanced automation
```

Deferred modules (`activities`, `documents`, `reports`, `super-admin`) remain scaffolded
in code but are implemented only to the extent an MVP dependency requires.

## 4. Relationship to V1

```
V1 Architecture
   |
   +---------------- MVP            (Company, Workforce, Auth, Scheduling, Attendance, Leave, Dashboard)
   |
   +---------------- Deferred V1    (AI, Billing, Documents, Advanced Reports, ...)
```

The MVP must remain a **subset** of the V1 architecture. Do not create throwaway MVP code
or an MVP-specific architecture. Deferred capabilities must be addable later without a major
rewrite.

## 5. Implementation Order

Follow `/docs/10-delivery/implementation-order.md` for V1 and the following MVP order:

```text
1. Foundation
2. Authentication
3. Company / Organization
4. Authorization
5. Employees
6. Availability / Leave
7. Scheduling
8. Conflict Engine
9. Attendance
10. Dashboard
11. End-to-End Testing
12. MVP Hardening
```

## 6. Definition of MVP Complete

The MVP is complete only when **all** of the following hold (see
`/docs/10-delivery/definition-of-done.md` and `/docs/10-delivery/mvp-status.md`):

- Authentication works.
- Tenant isolation is verified (Company A cannot read/write Company B data).
- Authorization is verified (Branch/Department/Team scopes behave correctly).
- Companies/organizations work.
- Employees work.
- Schedules work.
- Assignments work.
- Conflicts are correctly detected and enforceable.
- Schedules can be published.
- Attendance works (with idempotency).
- Leave works and blocks scheduling when approved.
- Dashboard works (employee + manager).
- Mobile/responsive workflows work.
- Critical tests pass (tenant isolation, authorization, scheduling conflicts, attendance
  idempotency, leave→scheduling, security, data integrity).
- Type-check, lint, and build pass.
- Database migrations work.
- No known critical/high security issues remain.

## 7. Autonomy & STOP Conditions

- Operate autonomously when a requirement is clearly defined by `/docs`, this MVP scope,
  the ADRs, or the existing domain architecture.
- **STOP and request approval** for any decision that materially changes: database
  architecture, identity architecture, tenant isolation, authorization architecture,
  scheduling rules, attendance rules, security architecture, core product behavior,
  the V1 architecture, or the MVP scope.
- Do not invent a solution to a major architectural ambiguity. For minor decisions, follow
  the existing architecture and proceed.
