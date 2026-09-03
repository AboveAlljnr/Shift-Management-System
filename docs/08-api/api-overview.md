# API Overview

The API is RESTful, versioned under `/api/v1`, and documented via OpenAPI.

## URL structure

```text
/api/v1/auth/...
/api/v1/companies
/api/v1/branches
/api/v1/departments
/api/v1/teams
/api/v1/employees
/api/v1/members               ← CompanyMembership management
/api/v1/roles
/api/v1/permissions
/api/v1/schedules
/api/v1/shifts
/api/v1/schedule/optimize     ← AI optimization request
/api/v1/attendance
/api/v1/attendance/events     ← clock events (offline sync endpoint)
/api/v1/leave
/api/v1/activities
/api/v1/documents
/api/v1/notifications
/api/v1/reports
/api/v1/billing
/api/v1/super-admin/...
```

## Tenant context

Tenant (company) context comes from the authenticated identity and validated `CompanyMembership` — **not** from the URL path or request body `companyId` field.

A client cannot impersonate a different company by supplying a different `companyId` in the request.

## Conventions

- **Format**: JSON
- **Timestamps**: ISO 8601 (`2026-09-01T13:00:00Z`)
- **Pagination**: consistent `page`, `limit`, `total` on list responses
- **Response envelope**: `{ data, message }` for single resources; `{ data, pagination }` for lists
- **Errors**: machine-readable `errorCode` + human-readable `message` + optional `errors` map (field validation)
- **Request IDs**: `X-Request-ID` header on all responses for tracing
- **Idempotency**: mutation endpoints that may be retried accept an `Idempotency-Key` header
- **Optimistic concurrency**: important editable resources include a `version` field; updates must supply the expected version

## Versioning

Breaking changes require a new API version (`/api/v2/...`). Non-breaking additions do not require a new version.

## OpenAPI

OpenAPI 3.0 spec is generated from the NestJS Swagger plugin and is the authoritative API contract. Do not manually write the OpenAPI file — it is generated from decorator metadata.

## WebSocket

WebSocket connections are served via Socket.IO at `/ws`. Authentication and room authorization are documented in `01-architecture/architecture-decisions.md` ADR-007 and `01-architecture/system-architecture.md`.
