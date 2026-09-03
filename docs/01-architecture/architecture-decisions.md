# Architecture Decisions — V1

This document is the canonical record of resolved architecture decisions for the Workforce Management Platform V1. It supersedes any implicit or contradictory decisions in other documentation.

---

## ADR-001: Tenant Root Entity — Company

**Status:** LOCKED

**Decision:**
`Company` is the tenant root entity.

**Terminology:**

| Concept | Name |
|---|---|
| Domain entity | `Company` |
| Database table | `companies` |
| Foreign key | `companyId` |
| Backend context object | `CompanyContext` |
| API route prefix | `/api/v1/companies` |

**Rules:**
- Never introduce `Tenant` as a competing domain entity.
- All tenant-scoped records must have `companyId` directly or through a controlled parent relationship within the same company.
- The term `tenant` may appear as a generic concept in infrastructure comments but must not appear in domain model names, Prisma models, or API routes.

---

## ADR-002: Identity — Membership Model

**Status:** LOCKED

**Decision:**
Use a three-entity identity model: `User`, `CompanyMembership`, and `Employee`.

```text
User
  |
  +-- CompanyMembership ---- Company
  |
  +-- Employee (nullable userId)
```

### User

Represents authentication/account identity only.

Fields include authentication credentials, email verification, password reset, 2FA configuration, account status, and last login. A `User` record does not carry HR, workforce, or organizational data.

### CompanyMembership

Represents a user's relationship with a specific company. Contains:

- `userId`
- `companyId`
- `status` (active, suspended, invited, revoked)
- `joinedAt`
- `revokedAt` (nullable)
- Role and permission associations (via `UserRole` linked to a membership or company scope)

A user may belong to multiple companies. The active company is selected at session time and validated server-side.

### Employee

Represents the operational workforce profile. Contains HR data, employment details, organizational assignment (branch, department, team), skills, certifications, and employment lifecycle.

An `Employee` may optionally link to a `User` account (`userId` nullable). This supports:
- Employees who do not have a system login
- Service accounts that are users but not employees
- Future service/external integrations

**Rule:** Never store HR or workforce data on `User`. Never assume `User` and `Employee` are the same record.

---

## ADR-003: Hierarchical Organizational Authorization

**Status:** LOCKED

**Decision:**
Implement hierarchical organizational scopes.

```text
Company
  └── Branch
       └── Department
            └── Team
                 └── Employee
```

**Scope Inheritance Rules:**

A permission granted at a higher organizational level recursively grants authorized access to all descendants.

| Scope Level | Grants Access To |
|---|---|
| Company | Everything within the company |
| Branch | That branch + all its departments, teams, employees |
| Department | That department + all its teams, employees |
| Team | That team + all its employees |
| Self | Only the user's own employee record |

Scope is **downward only**. A Branch-scoped manager cannot access:
- Resources in other branches
- The Company level as a whole
- Lateral branches

**Implementation:**

- A centralized `AuthorizationService` evaluates all access decisions.
- A `ScopeResolver` resolves organizational hierarchy for a given user.
- A `PermissionGuard` is applied globally; individual controllers never implement their own scope checks.
- Scope resolution queries must be efficient — index organizational hierarchy paths or cache them in Redis where latency is critical.

---

## ADR-004: Authentication and Active Company Context

**Status:** LOCKED

**Decision:**
Authentication and company context resolution are a defined pipeline.

```text
HTTP Request
  ↓
JWT Bearer Token → authenticate User identity
  ↓
CompanyMembership lookup → validate active membership for the requested company
  ↓
Active CompanyContext resolved server-side
  ↓
Roles resolved for this User × Company pair
  ↓
Permissions resolved for those roles + overrides
  ↓
Organizational Scope resolved
  ↓
Handler executes
```

**Token strategy:**
- Access token: short-lived JWT (15 minutes), signed with `JWT_ACCESS_SECRET`, carries `userId` and `companyId` (the active company at login time).
- Refresh token: long-lived (7 days), stored as a hashed record in PostgreSQL (`refresh_tokens`), rotated on each use.
- Company context in the token is validated against `CompanyMembership` on every request — a revoked or suspended membership must reject even a valid token.

**Active company selection:**
- On login, the user presents credentials + desired `companySlug`.
- The server validates membership and issues tokens scoped to that company.
- Company switching (future V1.x) will require a new token issuance via the `/auth/switch-company` endpoint.

**Membership revocation:**
- Revoking a `CompanyMembership` must also revoke all active refresh tokens for that user–company pair.
- Tokens revoked at the `refresh_tokens` table level.

**2FA architecture:**
- Optional per company (configurable).
- TOTP-based (RFC 6238) using a standard authenticator app.
- TOTP secret encrypted at rest in the database.
- 2FA challenge issued as a short-lived session state after successful password verification.

**Password reset:**
- Time-limited, single-use token sent to verified email address.
- Token hashed and stored in the database; invalidated after use.

**Account lockout:**
- Failed login attempts tracked with exponential backoff.
- Configurable threshold (default 5 attempts → 15-minute lockout).
- Implemented at the NestJS application layer using Redis counters + TTL.

---

## ADR-005: Scheduling Conflict Overrides

**Status:** LOCKED

**Decision:**
Scheduling conflict overrides are a dedicated domain entity: `ShiftConflictOverride`.

```text
ShiftConflictOverride {
  id
  companyId
  shiftId
  employeeId (nullable — some conflicts are shift-level, not employee-level)
  ruleIdentifier      -- machine-readable conflict type (e.g. MIN_REST, MAX_HOURS)
  severity            -- WARNING | BLOCKING
  reason              -- required text from the manager
  overriddenBy        -- userId of the authorizing manager
  overriddenAt
  metadata            -- JSON: includes related shift IDs, constraint values, etc.
}
```

**Rules:**
- An override is only created when a manager explicitly acknowledges and confirms the conflict.
- The AI optimizer must never create an override. It may flag conflicts; the human manager approves.
- Hard constraints configured as non-overridable cannot produce an override record. They block the operation entirely.
- Overrides are append-only. They are never updated or deleted (audit integrity).
- Overrides must be included in the audit log.

---

## ADR-006: Scheduling Optimizer Architecture — Dual Path

**Status:** LOCKED

**Decision:**
Two execution paths for schedule optimization.

### Path A — Interactive (synchronous)

```text
Next.js UI
  ↓ (user requests optimization)
NestJS API
  ↓ HTTP POST with 30s timeout
Python Optimizer (FastAPI + OR-Tools)
  ↓ result
NestJS API validates result against scheduling rules
  ↓ returns proposal
Next.js UI presents proposals for manager review
```

Timeout: **30 seconds**. If the optimizer responds within 30 seconds, the result is returned synchronously.

### Path B — Asynchronous fallback

If the optimizer exceeds the interactive timeout:

```text
NestJS API receives timeout / accepts long-running request
  ↓
Enqueue job to BullMQ queue (SCHEDULE_OPTIMIZATION)
  ↓ job carries idempotent request_id, company_id, parameters
Python Optimizer worker picks up job
  ↓ completes optimization (no time limit in async path)
Result stored in database (linked to request_id)
  ↓
Notification sent to requesting manager via WebSocket + in-app notification
Manager can also poll status via GET /api/v1/schedule/optimize/{requestId}
```

**Rules:**
- Job identifier is idempotent. Re-submitting the same parameters returns the existing result or job status.
- Timeout must not lose the optimization state. The synchronous request is converted to an async job before the 30s deadline.
- Both paths ultimately produce the same output structure: a validated schedule proposal with conflicts and uncovered requirements.

---

## ADR-007: WebSocket Tenancy and Authorization

**Status:** LOCKED

**Decision:**
All WebSocket connections are tenant-scoped and server-authorized.

**Room naming scheme:**

```text
company:{companyId}
company:{companyId}:branch:{branchId}
company:{companyId}:department:{departmentId}
company:{companyId}:team:{teamId}
```

**Authorization rules:**
- A client presents a valid JWT access token during the WebSocket handshake.
- The server validates the token and resolves the user's CompanyMembership and organizational scope.
- Room subscriptions are server-controlled. The client declares intent; the server decides which rooms to join.
- A client may never join a room for a company or org unit outside their resolved scope.
- Company-level rooms are for admin/owner/super-admin users only.
- Branch/department/team rooms follow the same hierarchical scope rules as the REST API (ADR-003).

**Events emitted to rooms:**

| Event | Room |
|---|---|
| `schedule.published` | `company:{id}:branch:{id}` |
| `shift.changed` | `company:{id}:department:{id}` |
| `attendance.clocked_in` | `company:{id}:department:{id}` |
| `attendance.clocked_out` | `company:{id}:department:{id}` |
| `leave.decision` | individual user subscription |
| `notification.created` | individual user subscription |
| `optimization.completed` | individual user subscription |

---

## ADR-008: Billing — Active Employee Seat Model

**Status:** LOCKED

**Decision:**
The billable unit is **Active Employee count**.

An "active employee" is an `Employee` record with `status = active` within the company.

**Lifecycle events affecting billing:**
- Employee **activation** → seat consumed → billing triggers if over plan limit.
- Employee **deactivation** → seat released → effective at start of next billing cycle for downgrades.
- Reactivation → seat re-consumed immediately.

**Plan limits:**
- The `SubscriptionPlan` entity defines a `maxEmployees` limit.
- The system enforces this limit at the point of employee activation (soft block with admin warning, configurable hard block).

**Trial:**
- 14-day trial. Trial limits enforced by `SubscriptionPlan.trialEmployeeLimit`.
- Trial expiry triggers grace period (configurable, default 7 days) before hard access restriction.

**Upgrade:**
- Seat count increases are effective immediately; billing is prorated.

**Downgrade:**
- Seat count decreases or plan downgrades take effect at the end of the current billing period.
- If active employee count exceeds the new plan limit at downgrade time, the admin must deactivate employees before the downgrade applies.

**Grace period:**
- Failed payments trigger a configurable grace period (default 7 days).
- During grace period: read-only access for employees; admin/owner retain access to billing.
- Post-grace: company access suspended until payment resolved.

**Provider abstraction:**
- All billing operations go through `BillingService`.
- `BillingService` wraps provider-specific logic. Swapping providers does not require changes to domain modules.
- Webhook events from the billing provider are idempotent and recorded in `BillingEvent`.

---

## Open Decisions

The following items cannot be resolved from existing documentation and require explicit product or engineering decisions before the database schema is finalized.

### OD-001: Multi-Company User Login Experience

**Issue:** The membership model allows a user to belong to multiple companies. It is unresolved whether V1:
- (a) Shows a company-picker screen after login if the user belongs to multiple companies.
- (b) Defaults to the first/only company and defers multi-company switching to V1.x.

**Impact:** Affects `/auth/login` request shape, token payload, and company-picker UI page.

### OD-002: Cross-Branch Staffing Authorization

**Issue:** `docs/04-workforce/organization.md` states "cross-branch staffing is configurable" but does not define the authorization model. It is unresolved how a shift in Branch A can be assigned to an employee from Branch B.

**Impact:** Affects `ScopeResolver` logic and `ShiftAssignment` validation in the scheduling engine.

### OD-003: Shift Review / Approval Workflow

**Issue:** The shift lifecycle is `Draft → Review → Approval (optional) → Published` (docs/05-scheduling/shifts.md). It is unresolved:
- Who is the "reviewer" role?
- Is approval a separate role from publishing?
- Is approval always required or only when the company configures it?

**Impact:** Affects `shifts.status` enum, `schedule_versions`, and the publishing event in BullMQ.

### OD-004: Invitation Flow for New Employees

**Issue:** Employee onboarding implies an invitation (docs/04-workforce/employees.md: "Invited/Created"). The mechanism is unresolved:
- Does the system send an invitation email with a signup link?
- Can an employee be created without a `User` account?
- Who controls the invitation token?

**Impact:** Affects `CompanyMembership.status` values and the auth module invitation workflow.

### OD-005: Activity vs Leave Relationship

**Issue:** `docs/04-workforce/activities.md` lists "leave" as an activity type. `docs/04-workforce/leave.md` defines Leave as a distinct domain. It is unresolved whether approved leave:
- (a) Creates a corresponding `Activity` record for scheduling purposes, or
- (b) Operates independently, with the scheduling engine reading `LeaveRequest` directly.

**Impact:** Affects how the scheduling engine queries constraints and whether `Activity` and `Leave` are decoupled or linked.
