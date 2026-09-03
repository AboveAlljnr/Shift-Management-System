# Entity Design Rules

## Company (Tenant Root)

`Company` is the tenant root entity. All tenant-owned records carry `companyId` directly or through a controlled parent chain within the same company. See `01-architecture/architecture-decisions.md` ADR-001.

## User vs CompanyMembership vs Employee

These are three distinct entities. See ADR-002 for the canonical specification.

```text
User
  |
  +-- CompanyMembership ---- Company
  |
  +-- Employee (companyId, userId nullable)
```

### User

Authentication and account identity only.

- `id`
- `email` (globally unique)
- `passwordHash`
- `emailVerifiedAt` (nullable)
- `twoFactorSecret` (nullable, encrypted)
- `twoFactorEnabledAt` (nullable)
- `status` (active, suspended, pending_verification)
- `lastLoginAt`
- `createdAt`, `updatedAt`

A `User` record carries **no** company affiliation, HR data, or workforce profile.

### CompanyMembership

The access relationship between a User and a Company.

- `id`
- `userId`
- `companyId`
- `status` (invited, active, suspended, revoked)
- `invitedAt`
- `joinedAt` (nullable)
- `revokedAt` (nullable)
- `revokedBy` (userId, nullable)
- `createdAt`, `updatedAt`

Roles and permission overrides are associated at the CompanyMembership level (via `UserRole.membershipId` and `UserPermissionOverride.membershipId`).

### Employee

The operational workforce profile.

- `id`
- `companyId`
- `userId` (nullable — employee may not have a User account)
- `employeeNumber` (unique within company)
- Personal and contact fields
- `employmentTypeId`
- `branchId`, `departmentId`, `teamId`
- `primaryPositionId`
- `managerId` (self-reference within company)
- `status` (active, inactive, on_leave, terminated)
- `hireDate`
- Emergency contact fields
- `createdAt`, `updatedAt`

Historical `Employee` records must remain readable for reporting and audit even after status changes.

## Shift vs ShiftRequirement vs ShiftAssignment

A shift is a scheduled work period. A requirement defines what roles/skills are needed. An assignment links an employee to the shift.

```text
Shift
  |
  +-- ShiftRequirement (headcount, position, skills, certifications)
  |
  +-- ShiftAssignment
         |
         +-- Employee
         |
         +-- ShiftConflictOverride (if assignment overrode a conflict)
```

This supports:
- Multiple employees per shift
- Role-based and skill-based staffing requirements
- Full conflict override audit trail

## Attendance: Record vs Event

The `AttendanceRecord` represents the normalized daily/work-period state (computed result).

`AttendanceEvent` records are immutable events representing what actually happened:

- `clock_in`
- `clock_out`
- `break_start`
- `break_end`
- `correction`
- `manual_override`

`AttendanceEvent` records are never updated or deleted. Server normalization produces the current `AttendanceRecord` state from the event stream.

`AttendanceCorrection` represents an authorized manager modification, linked to the original `AttendanceRecord` and preserved for audit.

## Schedule Versioning

Published schedules must be versioned.

```text
Schedule (week/period container)
  |
  +-- ScheduleVersion (snapshot at each publish/change)
       |
       +-- Shifts (as they existed at that version)
```

Changes after publish create a new `ScheduleVersion`. This allows the UI to show history and the audit log to reference the exact schedule state at a given time.

## Documents

Files live in object storage. Metadata and authorization live in PostgreSQL.

```text
Document
  |
  +-- DocumentVersion (one per upload; latest is current)
```

Document access control is enforced at the application layer using `companyId` + `employeeId` ownership + permission checks.

## Billing

The billing model is based on **Active Employee count**. See ADR-008.

```text
Company
  |
  +-- Subscription ---- SubscriptionPlan
       |
       +-- Invoice
       |     +-- Payment
       |           +-- PaymentAttempt
       |
       +-- BillingEvent (append-only log)
```

Provider webhook events are processed idempotently and stored in `BillingEvent`.
