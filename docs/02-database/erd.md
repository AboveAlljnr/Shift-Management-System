# ERD — V1 Conceptual Model

The canonical domain model. Physical PostgreSQL schema and Prisma models are generated from this after relationship and constraint review is complete.

Tenant root entity is `COMPANY` (never `TENANT`).

```text
COMPANY
  |
  +-- BRANCH
  |     |
  |     +-- DEPARTMENT
  |           |
  |           +-- TEAM
  |
  +-- USER (global — no companyId on User)
  |     |
  |     +-- COMPANY_MEMBERSHIP ---- COMPANY
  |     |       |
  |     |       +-- USER_ROLE ---- ROLE ---- ROLE_PERMISSION ---- PERMISSION
  |     |       +-- USER_PERMISSION_OVERRIDE ---- PERMISSION
  |     |       +-- ACCESS_SCOPE
  |     |
  |     +-- REFRESH_TOKEN
  |
  +-- EMPLOYEE (companyId, nullable userId)
  |     |
  |     +-- AVAILABILITY_RULE
  |     +-- AVAILABILITY_EXCEPTION
  |     +-- EMPLOYEE_SKILL ---- SKILL
  |     +-- EMPLOYEE_CERTIFICATION ---- CERTIFICATION
  |     +-- LEAVE_BALANCE ---- LEAVE_TYPE
  |     +-- LEAVE_REQUEST
  |     +-- ATTENDANCE_RECORD
  |     |     +-- ATTENDANCE_EVENT (immutable)
  |     |     +-- BREAK
  |     |     +-- ATTENDANCE_CORRECTION
  |     +-- DOCUMENT ---- DOCUMENT_VERSION
  |     +-- NOTIFICATION
  |     +-- ACTIVITY_ASSIGNMENT ---- ACTIVITY
  |
  +-- SHIFT_TEMPLATE
  +-- SCHEDULE ---- SCHEDULE_VERSION
  |      |
  |      +-- SHIFT
  |            |
  |            +-- SHIFT_REQUIREMENT
  |            |     +-- SHIFT_REQUIREMENT_SKILL
  |            |     +-- SHIFT_REQUIREMENT_CERTIFICATION
  |            |
  |            +-- SHIFT_ASSIGNMENT ---- EMPLOYEE
  |            |     +-- SHIFT_CONFLICT_OVERRIDE
  |            |
  |            +-- SHIFT_HISTORY (immutable change log)
  |            +-- SHIFT_SWAP_REQUEST
  |            +-- OPEN_SHIFT_REQUEST
  |
  +-- ACTIVITY ---- ACTIVITY_TYPE
  +-- HOLIDAY
  +-- ANNOUNCEMENT ---- ANNOUNCEMENT_ACKNOWLEDGMENT
  +-- GEOFENCE
  |
  +-- SUBSCRIPTION ---- SUBSCRIPTION_PLAN
  |       |
  |       +-- INVOICE
  |       |     +-- PAYMENT
  |       |           +-- PAYMENT_ATTEMPT
  |       |
  |       +-- BILLING_EVENT (append-only)
  |       +-- PROVIDER_WEBHOOK_EVENT
  |
  +-- AUDIT_LOG (append-only)
  +-- OUTBOX_EVENT
  +-- FEATURE_FLAG
  +-- MAINTENANCE_WINDOW
  +-- OPTIMIZATION_REQUEST (tracks async optimizer jobs)
```

## Notes

- `COMPANY_MEMBERSHIP` replaces any direct `User.companyId` model.
- `SHIFT_CONFLICT_OVERRIDE` is a dedicated entity — not a field on `SHIFT_ASSIGNMENT`.
- `ATTENDANCE_EVENT` records are immutable. Corrections go through `ATTENDANCE_CORRECTION`.
- `OPTIMIZATION_REQUEST` tracks both interactive and async optimizer jobs for status polling.
- `USER_ROLE` is scoped to a `COMPANY_MEMBERSHIP` (not directly to `USER`).
- `ACCESS_SCOPE` records the organizational scope (branch/department/team) associated with a `USER_ROLE`.
