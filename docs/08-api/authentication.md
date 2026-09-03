# API Authentication

## Request identity pipeline

Every protected request resolves identity through the following pipeline:

```text
HTTP Request
  |
  v
JWT Bearer Token verified (signature, expiry)
  |
  v
User identity resolved from token (userId, companyId claim)
  |
  v
CompanyMembership validated server-side
  — membership exists for this userId × companyId pair
  — membership.status = active
  — membership not revoked
  |
  v
Active CompanyContext established
  |
  v
Roles resolved (UserRole records for this membership)
  |
  v
Permissions resolved (RolePermission + UserPermissionOverride)
  |
  v
Organizational scope resolved (AccessScope for this membership)
  |
  v
Handler executes with full CompanyContext
```

## Token claims

Access token (JWT) payload:

```json
{
  "sub": "<userId>",
  "companyId": "<companyId>",
  "email": "<user email>",
  "iat": ...,
  "exp": ...
}
```

The `companyId` in the token is the active company at login time. It is **always** re-validated against `CompanyMembership` on every request — a revoked membership rejects the request even if the token is valid.

## Background jobs

Background jobs include explicit `companyId` context in their job payload. They do not use HTTP tokens. The job processor validates the company is active before executing.

## Refresh token handling

- Refresh tokens are long-lived (7 days) and stored as a `SHA-256` hash in `refresh_tokens`.
- Rotation: each use issues a new refresh token and revokes the old one.
- Per-device: one refresh token per device/client session.
- Revocation: individual tokens can be revoked. Revoking a `CompanyMembership` revokes all refresh tokens for that user–company pair.

## Endpoint authorization

Every protected route handler is decorated with the required permission(s) and optional scope constraints. Authorization is evaluated by `PermissionGuard` centrally — handlers do not implement their own checks.

Example flow:

```text
GET /api/v1/employees
  → requires: employee.read
  → scope: resolved from caller's AccessScope (may limit results to branch/department/team)

POST /api/v1/shifts/:id/assign
  → requires: shift.assign
  → scope: caller must have scope over the shift's branch/department/team

POST /api/v1/shifts/:id/override-conflict
  → requires: shift.conflict_override
  → scope: caller must have scope over the shift
```

## Super Admin authentication

Super Admins authenticate via the same `User` entity and JWT mechanism. However, their authorization does not use `CompanyMembership`. The system checks a platform-level Super Admin role at the application layer. Super Admin routes are on separate controllers that require platform-level authorization.
