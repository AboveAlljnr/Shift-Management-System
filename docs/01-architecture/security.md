# Security Architecture

## Authentication

Full specification is in `architecture-decisions.md` ADR-004.

Summary:

- Email/password authentication
- Email verification (required before company access)
- Password reset via time-limited, single-use hashed token sent to verified email
- Optional per-company 2FA (TOTP / RFC 6238; secret encrypted at rest)
- Session management via JWT access token (15 min) + hashed refresh token (7 days) in PostgreSQL
- Refresh token rotation on every use
- Configurable inactivity timeout (implemented via access token expiry + refresh token idle TTL)
- Account lockout: failed attempt counter in Redis, configurable threshold (default 5 → 15-minute lockout)
- Device/session list per user: refresh tokens are per-device and individually revocable

## Authorization

Authorization combines all of the following evaluated in order:

1. **Company membership** — user must have an active `CompanyMembership` for the requested company
2. **Role** — roles assigned via `UserRole` for the user × company pair
3. **Permission** — permissions assigned to roles via `RolePermission`, plus individual `UserPermissionOverride`
4. **Organizational scope** — hierarchical scope (Company → Branch → Department → Team → Self) resolved by `ScopeResolver`
5. **Target resource** — the specific resource being accessed must fall within the resolved scope
6. **Action** — the requested action (read, create, edit, export, etc.) must be granted by the resolved permissions

Access is denied by default if any element cannot be established.

See `03-auth/scopes.md` for scope resolution details.

## Data protection

- TLS in transit for all HTTP and WebSocket connections
- Encryption at rest for database and object storage
- Secrets managed outside source control (environment variables, secrets manager in production)
- Object storage URLs are pre-signed with short expiry (not publicly accessible)
- Least-privilege service credentials for all infrastructure
- TOTP secrets encrypted at rest in the database

## Auditability

Security-sensitive actions that must be recorded in `AuditLog`:

- login success / failure
- logout
- 2FA enable / disable
- password change / reset
- permission changes (role assignment, override creation)
- attendance corrections
- schedule changes (publish, lock, override)
- leave decisions (approve, reject)
- document access for sensitive documents
- report exports
- billing changes (plan change, payment failure, suspension)
- company suspension / reactivation
- administrative actions (Super Admin)
- CompanyMembership revocation

## Privacy

- GPS coordinates are recorded with attendance events only when GPS is enabled for the company.
- The platform does not continuously track employee location.
- Employees have visibility into their own recorded attendance location.
- Personal data deletion is subject to legal retention requirements; "Anonymized/Deleted" lifecycle applies where permitted.

## WebSocket security

WebSocket connections require a valid JWT access token at handshake time. Server-side room authorization is enforced before any subscription is confirmed. See `architecture-decisions.md` ADR-007.
