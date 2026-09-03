# Database Relationships

## Organizational hierarchy

```text
Company
  └── Branch (companyId)
       └── Department (companyId, branchId)
            └── Team (companyId, departmentId)
                 └── Employee (companyId, branchId nullable, departmentId nullable, teamId nullable)
```

An `Employee` may be assigned at branch, department, or team level. All assignments are within the same company.

## Identity relationships

```text
User (global — no companyId)
  └── CompanyMembership (userId, companyId)
       └── UserRole (membershipId, roleId)
            └── Role (companyId)
                 └── RolePermission (roleId, permissionId)
                      └── Permission
       └── UserPermissionOverride (membershipId, permissionId)
       └── AccessScope (membershipId, scopeType, scopeId)

User
  └── RefreshToken (userId — scoped per device)

Employee (companyId, nullable userId)
```

## Authorization relationships

```text
CompanyMembership
  |
  +-- UserRole ---- Role ---- RolePermission ---- Permission
  |
  +-- UserPermissionOverride ---- Permission (grants or revokes)
  |
  +-- AccessScope (branch | department | team | self)
```

Authorization evaluates: membership → roles → permissions → overrides → scope → resource.

## Scheduling relationships

```text
Company
  └── Schedule (companyId)
       └── ScheduleVersion (scheduleId)
            └── Shift (companyId, scheduleId, branchId optional, departmentId optional)
                 └── ShiftRequirement (shiftId)
                 │    └── ShiftRequirementSkill (requirementId, skillId)
                 │    └── ShiftRequirementCertification (requirementId, certificationId)
                 └── ShiftAssignment (shiftId, employeeId)
                 │    └── ShiftConflictOverride (shiftId, employeeId, overriddenBy userId)
                 └── ShiftHistory (shiftId — immutable)
                 └── ShiftSwapRequest (shiftId, requestingEmployeeId, targetEmployeeId optional)
                 └── OpenShiftRequest (shiftId, employeeId)
```

## Attendance relationships

```text
Employee
  └── AttendanceRecord (employeeId, companyId, workDate)
       └── AttendanceEvent (attendanceRecordId — immutable)
       └── Break (attendanceRecordId)
       └── AttendanceCorrection (attendanceRecordId, correctedBy userId)
```

`AttendanceEvent` and `AttendanceCorrection` are append-only. Records are never updated; corrections create new entries that adjust the normalized state.

## Leave relationships

```text
Company
  └── LeaveType (companyId)
       └── LeaveBalance (leaveTypeId, employeeId)
       └── LeaveRequest (leaveTypeId, employeeId, companyId)
```

Approved leave participates in scheduling validation. The scheduling engine reads `LeaveRequest.status` to enforce constraints.

## Document relationships

```text
Employee
  └── Document (employeeId, companyId)
       └── DocumentVersion (documentId — ordered by version number)
```

Files are in object storage. `Document` and `DocumentVersion` hold metadata and authorization in PostgreSQL.

## Billing relationships

```text
Company
  └── Subscription (companyId)
       └── SubscriptionPlan (platform-wide, not company-scoped)
       └── Invoice (subscriptionId, companyId)
            └── Payment (invoiceId)
                 └── PaymentAttempt (paymentId)
       └── BillingEvent (subscriptionId, companyId — append-only)
       └── ProviderWebhookEvent (platform-level — idempotent)
```

## Integrity requirements

- All tenant-scoped foreign keys must resolve within the same `companyId`.
- Employee numbers are unique within company (`UNIQUE(companyId, employeeNumber)`).
- Company slugs are globally unique.
- Branch/department/team codes are unique within company.
- `ShiftAssignment(shiftId, employeeId)` is unique — one employee cannot be assigned twice to the same shift.
- `CompanyMembership(userId, companyId)` is unique.
- Certification and skill links must reference existing employee and qualification records within the same company.
- `AuditLog` and `OutboxEvent` records are append-only — no updates or deletes.
- `AttendanceEvent` records are immutable.
- `ShiftConflictOverride` records are append-only.
- Billing objects are company-scoped unless explicitly platform-wide (e.g., `SubscriptionPlan`).
