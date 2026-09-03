# Multi-Tenancy

## Tenant model

`Company` is the tenant root entity. All terminology uses `Company`/`companyId`.

See `architecture-decisions.md` ADR-001 for the full locked decision.

## Tenant identity model

```text
User
  |
  +-- CompanyMembership ---- Company
  |
  +-- Employee (companyId, nullable userId)
```

- `User` is a global authentication identity (no `companyId` on User itself).
- `CompanyMembership` binds a User to a Company with status, roles, and timestamps.
- `Employee` is the workforce profile belonging to a Company.

A single user may belong to multiple companies through separate `CompanyMembership` records. The active company context is resolved server-side at request time.

## Rules

- Authenticated requests resolve a server-side `CompanyContext` from the JWT and validated `CompanyMembership`.
- Company identity must **not** rely solely on a user-controlled URL parameter or request body field.
- Repository and service queries must apply `companyId` scoping centrally — never trust a caller-supplied `companyId` without membership validation.
- Cross-company access is denied by default.
- Super Admin operations use explicit platform-level authorization; Super Admins do not have a `CompanyMembership`.
- Background jobs carry explicit `companyId` context.
- Cache keys include `companyId` where data is company-specific.
- Object-storage paths include `companyId` as a path prefix.
- Audit events include `companyId` where applicable.

## Membership revocation

Revoking a `CompanyMembership` must immediately invalidate all refresh tokens associated with that user–company pair. Access tokens (JWT) remain valid until natural expiry (15 minutes maximum).

## Defense in depth

Company isolation is enforced at:
1. Application authorization layer (CompanyContext validation)
2. Repository/query boundaries (`companyId` filter on all tenant-owned queries)
3. Database constraints (foreign keys, uniqueness scoped to `companyId`)

PostgreSQL Row-Level Security may be introduced after validating operational complexity for especially sensitive deployments (out of V1 scope).
