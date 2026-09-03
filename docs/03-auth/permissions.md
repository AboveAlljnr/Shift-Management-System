# Permissions

Permissions are granular and action-oriented.

Format: `resource.action`

## Employee permissions

- `employee.read`
- `employee.create`
- `employee.update`
- `employee.deactivate`
- `employee.export`
- `employee.read_sensitive` (salary, personal data)

## Scheduling permissions

- `schedule.read`
- `schedule.create`
- `schedule.edit`
- `schedule.publish`
- `schedule.approve`
- `schedule.lock`
- `schedule.override_lock`
- `shift.assign`
- `shift.conflict_override` (authorize a manager-override of a WARNING-level conflict)

## Attendance permissions

- `attendance.read`
- `attendance.correct`
- `attendance.override`
- `attendance.export`

## Leave permissions

- `leave.read`
- `leave.request` (self — implicitly for all authenticated employees)
- `leave.approve`
- `leave.export`

## Document permissions

- `document.read`
- `document.upload`
- `document.read_sensitive`
- `document.export`

## Report permissions

- `report.view`
- `report.export`

## Billing permissions

- `billing.view`
- `billing.manage`

## Company / settings permissions

- `company.settings.manage`
- `company.members.invite`
- `company.members.manage`
- `role.manage`
- `permission.override`

## Activity / leave management

- `activity.manage`
- `leave_type.manage`
- `leave_balance.adjust`

## Audit permissions

- `audit.read` (view the company audit log)

---

## Override model

A `UserPermissionOverride` can **grant** or **revoke** a specific permission for an individual `CompanyMembership`, independent of their roles.

This allows fine-grained customization without creating a new role for every edge case.

Overrides must include:
- The permission being granted or revoked
- The actor who created the override (`grantedBy`)
- A reason

Export and sensitive-data access are always separate permissions — they are never implied by a general read permission.
