# Roles

## Super Admin

Platform-wide operations. Not a `CompanyMembership` role — Super Admins exist outside the company hierarchy and have platform-level authorization only.

## Company Owner

Full company access by default (every action in the permission catalog, including `audit.read`). Set at company creation. Must have an active `CompanyMembership` with the Owner role.

## Company Admin

Company administration with configurable permission set. Assigned via `CompanyMembership` + `UserRole`.

## Manager

Workforce and scheduling management within authorized organizational scope (branch, department, or team level).

## Shift Manager

Shift and team management within an explicitly authorized scope. A subset of Manager capabilities.

## Employee

Self-service workforce functions only (own schedule, own attendance, own leave, own profile).

---

## How roles work

Roles are permission bundles assigned to a `CompanyMembership`. They are not the sole authorization mechanism.

The full authorization pipeline:

```text
CompanyMembership
  |
  +-- UserRole (role assigned to this membership)
  |     |
  |     +-- Role
  |          |
  |          +-- RolePermission ---- Permission
  |
  +-- UserPermissionOverride (individual grant or revoke)
  |
  +-- AccessScope (organizational scope for this role assignment)
```

A user may hold multiple roles within the same company, each with its own scope.

## System roles vs custom roles

- System roles (Owner, Admin, Manager, Shift Manager, Employee) are created per company and cannot be deleted.
- Admins may create custom roles with specific permission sets.
- Super Admin role is a platform-level concept, not stored in `company_memberships`.
