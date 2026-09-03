# Access Scopes

## Organizational hierarchy

```text
Company
  └── Branch
       └── Department
            └── Team
                 └── Employee (self)
```

## Scope types

| Scope | scopeType | scopeId |
|---|---|---|
| Company-wide | `company` | companyId |
| Branch | `branch` | branchId |
| Department | `department` | departmentId |
| Team | `team` | teamId |
| Self only | `self` | employeeId |

## Scope inheritance (downward only)

A scope at a higher level grants authorized access to all organizational descendants.

```text
Branch A scope
    ↓ grants
All departments under Branch A
    ↓ grants
All teams under those departments
    ↓ grants
All employees assigned to those teams
```

**Scope is never upward or lateral:**

```text
Team A1-1 scope
    ✓ Team A1-1
    ✓ Employees in Team A1-1

    ✗ Department A1 as a whole
    ✗ Other teams in Department A1
    ✗ Branch A as a whole
    ✗ Any other branch
```

## Centralized scope resolution

All scope checks are performed by:

- **`ScopeResolver`** — resolves the set of resource IDs a user is authorized to access, given their `AccessScope` records and the organizational hierarchy.
- **`AuthorizationService`** — combines User identity, CompanyMembership, Roles, Permissions, and Scope to produce a binary access decision.
- **`PermissionGuard`** — NestJS guard applied at the route handler level; calls `AuthorizationService`. Controllers never implement their own scope checks.

## Authorization evaluation

```text
Request
  |
  v
Resolve User from JWT
  |
  v
Validate CompanyMembership (status = active, companyId matches token)
  |
  v
Resolve Roles for this membership
  |
  v
Resolve Permissions (from roles + overrides)
  |
  v
Check action permission granted
  |
  v
Resolve organizational scope for this user × role
  |
  v
Check target resource falls within scope
  |
  v
Access granted or denied
```

Deny by default. If scope cannot be established, access is denied.

## Cross-branch staffing (open decision)

Cross-branch shift assignment authorization is currently an open decision (see OD-002 in architecture-decisions.md). Until resolved, cross-branch assignments require Company-level or explicit multi-branch scope.

## Super Admin scope

Super Admin is a platform-level authorization that bypasses company membership entirely. Super Admin access is validated against a dedicated platform role — not a `CompanyMembership`.
