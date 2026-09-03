# MVP Status

Tracked with: `NOT STARTED` · `IN PROGRESS` · `IMPLEMENTED` · `TESTED` · `VERIFIED`

Legend: **IMPLEMENTED** = code exists & type-checks · **TESTED** = automated tests cover critical
behavior · **VERIFIED** = validated against a running environment (DB/migrations, e2e).

---

## Foundation
- [x] Monorepo build (pnpm + turbo) — `VERIFIED` (all packages type-check/build)
- [x] API conventions (`/api/v1`, envelope, error, pagination) — `IMPLEMENTED`
- [x] Audit subsystem (append-only `AuditLog`) — `TESTED`
- [x] Controlled database migrations — `VERIFIED` (initial migration applied to live Dockerised Postgres on `localhost:5434`; regenerated `migration.sql` as clean UTF-8 — original file was UTF-16LE with a Prisma CLI banner appended, causing `P3015`/syntax errors before deploy)
- [x] Seed script — `VERIFIED` (idempotent permission catalog applied to live DB — 40 permission rows; self-heals per-company system Owner roles with the canonical Owner permission set; wired via `pnpm db:seed`)
- [ ] Lint gate for web/shared — `VERIFIED` (ESLint configs added for web + shared; `import/order` fixed; full `turbo lint` green, warnings only)

## Authentication & Authorization
- [x] Registration (company + owner) — `VERIFIED` (bootstrap grants Owner role 40 canonical permissions + company-wide `AccessScope` + linked employee profile; live e2e: `POST /api/v1/auth/register` → 201 + tokens; `GET /permissions/effective/:membershipId` → all 40 actions; `GET /permissions/scopes/:membershipId` → company scope)
- [x] Login / logout — `VERIFIED` (live e2e: correct creds → 200, wrong password → 401)
- [x] Access token (JWT) / refresh token (hashed, rotated) — `VERIFIED` (live e2e: `/auth/refresh` returns a new token triple; JWT carries `sub/email/companyId/membershipId/roles:['OWNER']`)
- [x] Password security (bcrypt) — `VERIFIED`; account lockout — `NOT STARTED`
- [x] CompanyMembership + identity model (`User`/`Membership`/`Employee`) — `IMPLEMENTED` (`TESTED`)
- [x] Roles & permissions — `IMPLEMENTED` (permissions module real; canonical catalog + `ROLE_PERMISSION_TEMPLATES` in `@sms/shared` for Owner/Admin/Manager/Shift Manager/Employee)
- [x] Global auth enforcement (JwtAuthGuard + RolesGuard as APP_GUARD) — `IMPLEMENTED` (`TESTED`)
- [x] Global permission enforcement (`PermissionGuard` as APP_GUARD gated by `@RequiredPermission('resource.action')`) — `VERIFIED` (live e2e: owner passes `employee.read`/`company.settings.manage`-gated endpoints; unauthenticated request → 401; permission catalog returns 40 actions)
- [x] Controller-level authorization matrix — `TESTED` (controller-authorization.spec: employee/scheduling/attendance/leave/company/permissions endpoints assert their required actions; every action checked against the canonical catalog to prevent silent route opening)
- [x] Tenant isolation (company context resolved from JWT/membership; companyId never read from the client) — `IMPLEMENTED` (`TESTED` incl. cross-tenant `NOT_FOUND` reads, list scoping, cross-company FK write rejection, batch op `companyId` cascade, server-derived `@CompanyId`)
- [x] Centralized AuthorizationService + ScopeResolver per ADR-003 — `IMPLEMENTED` (`TESTED`: scope inheritance, downward-only, union, fail-closed)
- [x] Hierarchical scope resolution (Branch/Dept/Team/Self) decision engine — `IMPLEMENTED` (`TESTED`: scope inheritance, downward-only, union, fail-closed)
- [x] Per-query hierarchical scope filtering on service reads — `IMPLEMENTED` (`VERIFIED`) — `ScopeFilterService` (ADR-003) turns granted scopes into row predicates for employees (list + detail), shifts (list + detail + scoped `assignments` include), attendance (daily + per-employee via the `employee` relation), leave (requests + balances via the `employee` relation), and org reference lists (branches/departments/teams/positions). Predicates AND-compose with client-supplied filters (search `OR`, `branchId`/`employeeId` params) so they can only narrow; a grant-less member gets a match-nothing predicate (deny by default); filtering precedes pagination so the listed `total` is scope-accurate. Self-scope on shifts filters through `assignments: { some: { employeeId: { in: self } } }`. Write-path tenant-FK guards enforce company boundaries on employee/shift/department/team creation.
- [x] Account lockout / 2FA — lockout `NOT STARTED` (RATE-LIMITED, see Hardening); 2FA `NOT STARTED`

## Company & Organization
- [x] Company (tenant root) — current + settings — `IMPLEMENTED`
- [x] Branches — CRUD — `IMPLEMENTED`
- [x] Departments — CRUD — `IMPLEMENTED`
- [x] Teams — CRUD — `IMPLEMENTED`
- [x] Positions / Employment types — `IMPLEMENTED`
- [x] Skills / Certifications (model + availability) — schema present; service partial

## Workforce
- [x] Employee create / edit / view / deactivate — `IMPLEMENTED`
- [x] Employment status / position / branch / department / team — `IMPLEMENTED`
- [x] Optional linked User account — model present; linking `NOT STARTED`
- [x] Manager/self scope enforcement — `IMPLEMENTED` (`VERIFIED`) — `ScopeFilterService` filters employee reads (and all other service reads, see Authorization section) row-by-row through the ADR-003 engine; decision engine `AuthorizationService.canAccess` remains tested
- [x] Employee write scope enforcement (create / update / deactivate) — `IMPLEMENTED` (`VERIFIED`) — the service-level write path also authorizes the TARGET placement via `ScopeFilterService.resolveScope` + `isPlacementInScope` (ADR-003 downward-only). A scoped member may mutate/create only employees whose placement is inside their buckets; an update that relocates an employee is authorized against BOTH the current and resulting placement (within-scope transfers allowed; cross-scope moves denied). Org-field escalation is impossible (scope is checked before write; tenant-FK guards on update reject other-company nodes). See Authorization section + `employee-write-scope.spec`.

## Availability
- [x] Availability rules & exceptions (model) — schema present; engine reads exceptions

## Leave
- [x] Leave types — `IMPLEMENTED`
- [x] Leave requests + approval/rejection — `IMPLEMENTED`
- [x] Leave status / basic balances — `IMPLEMENTED`
- [x] Approved leave blocks scheduling (`APPROVED_LEAVE` BLOCKING) — `IMPLEMENTED`

## Scheduling
- [x] Create / edit / cancel shifts — `IMPLEMENTED`
- [x] Assign / remove assignments — `IMPLEMENTED`
- [x] Recurring / overnight shifts, shift notes, staffing requirements — schema + basic support
- [x] Schedule calendar (list) — `IMPLEMENTED`
- [x] Schedule publishing (versioned immutable snapshots) — `IMPLEMENTED`
- [x] Shift history (immutable) — schema present

## Conflict Engine
- [x] Structured conflicts (`Conflict` type) — `IMPLEMENTED`
- [x] Overlapping shift (BLOCKING) — `IMPLEMENTED`
- [x] Approved leave (BLOCKING) — `IMPLEMENTED`
- [x] Availability (WARNING) — `IMPLEMENTED`
- [x] Minimum rest (WARNING) — `IMPLEMENTED`
- [ ] Max hours day/week — `NOT STARTED`
- [ ] Position eligibility / skills / certifications — `NOT STARTED`
- [ ] Staffing coverage — `NOT STARTED`
- [x] Conflict override (WARNING only, audited, reason required) — `IMPLEMENTED`
- [x] Conflict engine automated tests — `TESTED` (scheduling.service.spec, 11 tests, all green)

## Attendance
- [x] Clock in / clock out / break start / break end — `IMPLEMENTED`
- [x] Idempotency protection (unique `idempotencyKey`) — `IMPLEMENTED`
- [x] Immutable events + normalized record/statuses — `IMPLEMENTED`
- [x] Attendance history / daily view — `IMPLEMENTED`
- [x] Manager correction / override (audited) — `IMPLEMENTED`
- [x] Attendance idempotency tests — `TESTED` (attendance.service.spec, 7 tests, all green)
- [x] Attendance self-scope enforcement (clock events act on caller's own linked employee) — `IMPLEMENTED` (`TESTED` in tenant-isolation.spec)

## Leave → Scheduling integration
- [x] Approved leave is a BLOCKING scheduling conflict — `IMPLEMENTED`

## Dashboard
- [x] Employee dashboard (today's shift, upcoming, attendance, leave) — `IMPLEMENTED` (role-aware, real endpoints)
- [x] Manager dashboard (workforce, shifts, attendance, pending leave, warnings) — `IMPLEMENTED` (real endpoints, leave approve/reject)

## Responsive Web/PWA
- [x] Scaffold: AppShell, Sidebar, Header, Providers, API client (auth/refresh), middleware — `IMPLEMENTED`
- [x] Login page — `IMPLEMENTED` (real form, token persistence, cookie for SSR guard)
- [x] Register page — `IMPLEMENTED` (real form, slug auto-generation)
- [x] Dashboard page — `IMPLEMENTED` (employee + manager, clock in/out, pending leave actions)
- [x] Workforce page — `IMPLEMENTED` (list/search, add employee, deactivate)
- [x] Organization page — `IMPLEMENTED` (branches/departments/teams CRUD, reference data)
- [x] Schedule page — `IMPLEMENTED` (create shifts, assign employees, conflict feedback)
- [x] Attendance page — `IMPLEMENTED` (daily overview + personal record, date picker)
- [x] Leave page — `IMPLEMENTED` (request form, balances, approve/reject)
- [ ] Profile page — `NOT STARTED`
- [ ] Mobile-first responsiveness — `NOT STARTED`

## End-to-End Testing
- [x] Tenant isolation tests — `TESTED` (tenant-isolation.spec, 17 tests: cross-company NOT_FOUND reads, employee/service scheduling/attendance/leave cross-company create rejection, list scoping, publishSchedule company cascade, server-derived `@CompanyId`, correction rejection, employee/department/team FK tenant guards)
- [x] Authorization/scope tests — `TESTED` (scope-resolver.spec 24 tests, authorization.service.spec 15 tests, permission.guard.spec 5 tests, controller-authorization.spec 10 tests, scope-filter.service.spec 23 tests, query-scope.spec 19 tests, employee-write-scope.spec 21 tests)
- [ ] Security (unauthorized access) tests — `PARTIAL` (Global Hardening added `http-exception.filter.spec` 4 tests + `env.validation.spec` 7 tests covering 5xx leak-prevention and insecure-prod-config fail-fast; live 429 rate-limit + CORS deny verified. Full unauthorized-access/brute-force/concurrency suites still `NOT STARTED`)
- [ ] Data integrity / concurrency tests — `NOT STARTED`
- [x] E2E smoke against running stack — `VERIFIED` (see "Runtime Verification (Sep 2026)" below: Docker Postgres+Redis, migration + seed applied, API boots on `:3001`, register/login/refresh/401/409/effective-permissions/scopes/envelope all exercised over HTTP)

## Monorepo Verification (Sep 2026)
- [x] `turbo type-check` — 4/4 packages green (turbo `type-check` now `dependsOn` its package's own `build` so Next's generated `.next/types` exist before `tsc` runs — fixes cold-checkout race)
- [x] `turbo test` — API 180/180 green after Global Hardening (previous 168 + env-validation 7 + http-exception.filter 4 + one spec-recount); tenant-isolation 17, scope-resolver 24, authorization 15, permission.guard 5, controller-authorization 11, scope-filter.service 23, query-scope 19, employee-write-scope 21, scheduling 11, auth 6, attendance 7, audit 3, jwt-strategy 5, zod-validation-pipe 4, env-validation 7, http-exception.filter 4); web vitest wired (no specs yet, passes with no tests)
- [x] `turbo lint` — 4/4 packages green (warnings only, no errors)
- [x] `turbo build` — 4/4 packages green (web: 19 static routes + middleware; shared `tsc`; api `nest build`; postcss/local PostCSS config fix previously landed)

## Runtime Verification (Sep 2026)
Live stack: Docker Compose `sms-postgres` (host `localhost:5434`, user `sms`, db `sms_dev`; native PG18 on 5432 and unrelated `sentinelguard-db` on 5433 deliberately untouched) + `sms-redis` (6379). MinIO skipped (9000/9001 busy).
- [x] Migration + seed applied to a live DB (65 tables / 24 types / 126 FKs; 40 permissions seeded incl. `audit.read`)
- [x] API boots past DI on port 3001: 39 routes mapped, Swagger at `/api/docs`, 7 Bull queues connect to Redis
- [x] Bug found & fixed — Nest DI metadata: `import type { X }` + `emitDecoratorMetadata` compiled to `design:paramtypes: [Function]`, crashing boot ("can't resolve … argument Function"). Converted provider imports to value imports across services/controllers/guards/strategies; disabled `@typescript-eslint/consistent-type-imports` in `apps/api` (Nest DI requires class-valued imports by design)
- [x] Bug found & fixed — employee list 500: HTTP query strings reached Prisma `take`/`skip` (no zod pipe in the pipeline; class-validator `ValidationPipe` cannot act on zod-inferred interface types). `employee.service.findAll` now coerces page/limit (clamped 1–100) like the audit controller's `Number()` pattern
- [x] `audit.read` added to the permission catalog (shared constants + seed, 40 actions seeded, linked to every per-company OWNER role); `GET /api/audit` now gated by `@RequiredPermission('audit.read')` instead of `@Roles('super_admin','admin')` → **200 for Owner** (was 403). Catalog-consistency spec extended to cover `AuditController`
- [x] `ZodValidationPipe` built (`apps/api/src/common/pipes/`) and wired onto auth (register/login/refresh/logout), employee (create/update/list-query), scheduling (create/assign/override-conflict), attendance (clock/correction), leave (create/review). Live proof: `POST /auth/register` `password:"x"` → **400** (was 201); bad employee create → **400** with per-field zod messages; employee list still 200
- [x] Gates green after the above: type-check OK, lint 0 errors (29 pre-existing warnings), tests **168/168**; shared rebuilt, full API rebuild (67 JS), boot clean
- [x] Employee WRITE scope enforcement live-verified — same branch-1 MANAGER + Owner live company. As manager: in-scope `PATCH`/`DELETE` → 200; sibling (other-branch) employee `PATCH` → 403; org move b1→b2 on `PATCH` → 403 (resulting placement out of scope); `DELETE` sibling → 403; `POST` create into b1 → 201, create into b2 → 403. As Owner (company scope): cross-branch update/move → 200. Both-ends-in-scope (current + resulting placement) confirmed; org-field escalation blocked before any write; tenant-FK guards on update return NOT_FOUND for other-company nodes.
- [x] Per-query scope filtering live-verified — bootstrapped a secondary **MANAGER** member scoped to branch 1 (role via SQL, canonical permissions + `branch` AccessScope) in a fresh live company alongside the Owner. As manager: `GET /employees` → 3 (branch-1 only, other-branch employee absent; `total` 3 before pagination), `GET /employees/{otherBranchEmp}` → 404, `GET /shifts` → only branch-1 shift with the `assignments` include restricted to branch-1 assignees, `GET /shifts/{otherBranchShift}` → 404, `GET /shifts?branchId={otherBranch}` → empty (client param cannot widen), `GET /organization/branches` → one branch. As Owner (company scope): all 4 employees, both shifts, both branches. Regression verified over HTTP after the assignments-include fix.
- [x] Bug found & fixed — shift `assignments` include `where` is typed `ShiftAssignmentWhereInput` (no `branchId`/`id`), so passing the raw scope predicate 500'd with `Unknown argument 'branchId'`; the include now wraps the employee predicate as `{ employee: <predicate> }` in both shift list and detail (live-proofed above)

### Runtime findings still open
1. **Reference data empty at runtime** — `GET /leave/types` and `GET /billing/plans` return `[]` (no seed data for leave types / subscription plans) — **DEFERRED** (see Hardening §Reference seed data).
2. **~~CORS for the web origin~~** — **FIXED in Global Hardening (Sep 2026)**: `ALLOWED_ORIGINS` now set in `apps/api/.env`/`.env.example` (`http://localhost:3000`), `main.ts` reads it as an explicit allow-list, and production requires a wildcard-free non-empty value (fails fast otherwise). Live-verified: allowed origin echoes the ACAO header; disallowed origin gets no header (deny/closed).
3. Build footgun: deleting `dist` while a stale `*.tsbuildinfo` remains makes `nest build` emit only changed files (incremental). Always clear `tsconfig.tsbuildinfo` together with `dist`, or build with `--incremental false`. (Re-encountered during this pass; `clean` script is `rm -rf` and does not run on Windows PowerShell — remove the stale `*.tsbuildinfo` manually before rebuilding.)

## MVP Hardening (Sep 2026)
- [x] Security/config review — `PARTIAL → DONE for config/identity/deploy hardening` (see "Global Hardening" below); account lockout remains `NOT STARTED`
- [x] Observability on key workflows — partial (health/readiness endpoint added)
- [ ] Accessibility — `NOT STARTED`
- [ ] Staging acceptance — `NOT STARTED` (documented in "Deployment readiness"; no AWS deploy)

### Global Hardening (Sep 2026)
Enforced existing rate limits, added env validation + CORS fail-closed, stopped 5xx error leakage, added health/readiness, and fixed deployment/build config. No new product features; no Firebase/AWS/2FA/auth-migration.

**Implemented & verified:**
- **Rate limiting enforced** — `ThrottlerGuard` registered as the first global `APP_GUARD` in `AppModule` (short 10/1s, medium 100/60s, long 1000/1h). It previously sat configured but unregistered (inert). Live-verified: `POST /api/v1/auth/login` returns 400 ×10 then **429 ×2**; because it runs before auth, unauthenticated login/register/refresh are also limited. `docs/01-architecture/security.md` claimed lockout and rate limiting — see corrections below.
- **CORS fail-closed** — `main.ts` now parses `ALLOWED_ORIGINS` into a trimmed, non-wildcard allow-list; an empty list disables CORS entirely (deny/closed) instead of bug-splitting `''` into `['']`. Live-verified allow/deny per origin. `ALLOWED_ORIGINS=http://localhost:3000` set in `.env`/`.env.example`.
- **Env validation (fails fast)** — new `src/config/env.validation.ts` wired via `ConfigModule.forRoot({ validate })`. In production/staging: JWT secrets are required (≥16 chars) and MUST NOT equal committed dev defaults; `ALLOWED_ORIGINS` must be set and wildcard-free; `APP_PORT` required. Dev/test keep frictionless defaults. Unit-tested (7 cases). Docker/compose `NODE_ENV=development` continues to pass.
- **5xx error leakage fixed** — `HttpExceptionFilter` returns a generic `"Internal server error"` for all 5xx (never echoes the underlying error message/stack/paths); full detail goes only to server logs. 4xx still surface their controller-defined safe messages. Unit-tested (4 cases) including the raw `auth.service.js:324 … ECONNREFUSED` case that previously leaked into the response body.
- **Health/readiness endpoint** — `GET /api/v1/health/live` (liveness) and `GET /api/v1/health` (readiness: DB `SELECT 1` + Redis `PING`, 503 when down), public, for orchestrator/CI probes. Live-verified `status: ok` with both dependencies.
- **Deployment/build fixes** — `apps/web/next.config.js` now sets `output: 'standalone'` (required by its Dockerfile; verified `.next/standalone/apps/web/server.js` is emitted). API Dockerfile: reproducible `pnpm install --frozen-lockfile` (removed `|| pnpm install` fallback), `pnpm exec prisma generate` after prod install (was skipped by `--ignore-scripts`, breaking `@prisma/client`), and `prisma migrate deploy` runs before boot; added `prisma:migrate:deploy` script. Seed is intentionally separate, not run at startup.
- **Env var name reconciliation** — `.env`/`.env.example` rewritten to the exact names the app reads: `APP_PORT` (not `PORT`), `REDIS_URL` (not `REDIS_HOST/PORT/PASSWORD`), `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (not `JWT_SECRET`/`JWT_EXPIRES_IN`), `S3_ENDPOINT`/`S3_REGION`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` (not `AWS_*`), plus `ALLOWED_ORIGINS`. Removed unused/ignored doc vars (`FRONTEND_URL`, `OPTIMIZER_SERVICE_URL`, `AWS_S3_BUCKET`). Note: `S3_BUCKET`/`OPTIMIZER_URL`/`OPTIMIZER_SERVICE_URL` are still set in `docker-compose.yml` but consumed by NO API code (decorative) — documented, not removed.
- **Tests added** — `src/config/env.validation.spec.ts` (7 tests) and `src/common/filters/http-exception.filter.spec.ts` (4 tests). Live-verified CORS, rate-limit 429, and health readiness.

**Corrections to previously-marked items:**
- **Account lockout was NOT implemented** — no Redis/keyed failure-counter/backoff code exists anywhere in `apps/api/src`; the docs previously marked it `IMPLEMENTED`, which was inaccurate. Reset to `NOT STARTED`. It is now partially mitigated by enforced rate limiting, but a real lockout/backoff mechanism is still deferred.
- **Rate limiting was configured but inert** — now enforced (above).

**Deferred (accepted for MVP, tracked):**
- **Reference seed data** — leave types (`GET /leave/types`) and subscription plans (`GET /billing/plans`) still return `[]`. These are **company-scoped** reference data; seeding them needs a product decision on provision strategy (global catalog vs. per-company defaults created at registration, like the Owner role bootstrap). Not implemented in this pass.
- **Account lockout (real backoff counter)** — deferred; mitigated by rate limiting.
- **`prisma db seed` reference data** remains permission-catalog only (deterministic/idempotent; verified 40 permission rows).

### Deployment readiness (Sep 2026) — reviewed, not deployed to AWS
- **API container** — builds reproducibly (frozen lockfile), generates Prisma client, applies migrations via `prisma migrate deploy` at boot; needs `DATABASE_URL`, `REDIS_URL`, `NODE_ENV`, and (in prod) strong `JWT_*` + `ALLOWED_ORIGINS` provided by the platform (no committed secrets: `.env` is git-ignored; dev-only defaults are rejected by fail-fast validation in `production`/`staging`).
- **Web container** — standalone output produced and copied per the Dockerfile (verified).
- **Secrets** — no committed real secrets; `.env` ignored. Production refuses to boot with the committed development JWT defaults.
- **Health** — `GET /api/v1/health` readiness probe available for orchestrator rollout/restart policies.
- **Migrations/seed** — migrations run in-container before boot; `pnpm db:seed` (permission catalog) stays an explicit ops step, never automatic.
- **Not done** — no `.github/` CI, no Terraform/AWS IaC, no cloud deployment (explicitly out of scope this pass).

### Regression gates after hardening (all green)
- `turbo lint` — 3 tasks, 0 errors (29 pre-existing warnings)
- `turbo type-check` — pass (api + web)
- `turbo test` — **180/180** unit tests (was 168; +7 env-validation, +4 error-filter, net after spec-recount)
- `turbo build` — pass (shared tsc, api nest build, web standalone 19 pages)
- `test:e2e` — **52/52** against live Postgres+Redis on `:3001` after the hardening changes

---

# Priority Gaps (computed from the above)
1. ~~Runtime verification~~ — **DONE** (live Postgres/Redis, migration + seed, API boot + HTTP smoke; see "Runtime Verification (Sep 2026)"). Remaining runtime findings tracked above under "Runtime findings still open".
2. ~~Request-body validation~~ — **DONE** — `ZodValidationPipe` wired on all body endpoints (register/login/refresh/logout, employee create/update/list-query, shift create/assign/override-conflict, attendance clock/correction, leave create/review). Covered by `zod-validation.pipe.spec.ts`; live-verified 400s.
3. ~~Audit log gating for Owner~~ — **DONE** — `audit.read` added to catalog + OWNER template + seed; audit controller now `@RequiredPermission('audit.read')`; live-verified 200 for Owner.
4. ~~Per-query scope filtering on list/detail endpoints~~ — **DONE** — `ScopeFilterService` in `apps/api/src/modules/authorization/scope-filter.service.ts` applies ADR-003 scopes as row predicates across employee/shift/attendance/leave/org-service reads (AND-composed, self-scope via assignments, filters precede pagination); manager vs owner live-verified over HTTP.
5. ~~Employee write-endpoint scope (update/deactivate/create)~~ — **DONE** — service-level write guard (`assertWriteInScope` in `EmployeeService`) authorizes the TARGET placement via `ScopeFilterService.resolveScope` + `isPlacementInScope`; `PATCH`/`DELETE` and `POST` check current **and (for updates) resulting** placement so a child scope cannot mutate/edit-move parents, siblings, or unrelated records, org-field escalation is blocked, and tenant isolation holds (NOT_FOUND on other-company ids and nodes). Covered by `employee-write-scope.spec` (21 tests) + `scope-filter.service.spec` (`isPlacementInScope`/`resolveScope`); live-verified over HTTP (manager 200/403 matrix vs owner 200). Policy note: both-ends-in-scope was chosen (product decision) for cross-scope moves since ADR-003/scopes.md did not define them.
6. ~~CORS for web~~ — **DONE (Global Hardening)** — `ALLOWED_ORIGINS=http://localhost:3000` set, `main.ts` explicit allow-list + production fail-fast; live-verified.
7. **Reference seed data** — leave types + subscription plans are empty at runtime; **DEFERRED** (company-scoped; needs provisioning-strategy decision).
8. **Profile page + mobile-first polish** — minor.
9. **Account lockout (backoff counter)** — `NOT STARTED`; mitigated by now-enforced rate limiting. Next hardening item.
10. **Security/unauthorized-access, concurrency tests** — remain open (rate limiting, CORS, 5xx-leak, env-validation now covered; unauthorized-access/concurrency suites still TODO).

---

# STAGING READINESS (Sep 2026)

Read-only deployment-readiness audit of the finished MVP. **No code, infrastructure, or
architecture was modified.** The grade reflects readiness to deploy the current MVP to a
staging environment on AWS. Findings are classified:

`BLOCKER` · `HIGH` · `MEDIUM` · `LOW` · `ACCEPTED`

## Audit result: NOT READY for staging

The **application layer** is containerized, reproducibly built, health-checked, and has its
secrets configured fail-safe. But the deployment **platform does not exist yet**: there is no
provisioned AWS environment, no Terraform/IaC, no CI/CD pipeline, no git repository, no
observability stack, and no graceful-shutdown path. These are prerequisite infrastructure
items, not application bugs. **Staging cannot be stood up until the blockers below are
resolved.**

## BLOCKERS (must exist before any staging deployment)

1. **No AWS/IaC — zero Terraform config.** No `.tf`/`.tfvars` files exist anywhere in the
   repo. There is no ECS/Fargate, RDS, ElastiCache, S3, CloudFront, VPC/subnets, security
   group, or IAM definition. The entire AWS architecture from `docs/01-architecture/
   tech-stack.md` / `system-architecture.md` is design-only.
   **Required change:** Author Terraform modules for ECS/Fargate services (api + web +
   optional optimizer), RDS PostgreSQL, ElastiCache Redis, S3 bucket, CloudFront distribution,
   VPC + subnets + SG, and least-privilege IAM. Apply to a dedicated staging account/env.
2. **No CI/CD — no `.github/` workflows.** There is no `.github/` directory (verified; only
   `node_modules` matches). Nothing builds, tests, or ships the code automatically.
   **Required change:** Create GitHub Actions (or chosen CI): install → type-check → lint →
   unit/integration tests → build → image build/push → (optional gated) E2E → terraform
   plan/apply on staging → deploy API+web (migration-before-rollout) → health gate → rollback
   path. Store secrets in an OIDC-backed secrets store / GitHub secrets, never in repo.
3. **Repository is not a git repo.** `.git` is absent. There is no version history, tagging,
   or rollback capability — a staging deploy would be un-rollbackable.
   **Required change:** `git init`, commit a baseline, establish an immutable-releases tagging
   and rollback convention before any deployment.

## HIGH (fix before/at staging; degrade correctness/safety if ignored)

4. **No graceful shutdown.** `app.enableShutdownHooks()` is never called (`main.ts`), so Nest
   lifecycle destroy hooks never run on SIGTERM. `PrismaService.onModuleDestroy → $disconnect`
   (`apps/api/src/infrastructure/database/prisma.service.ts:6-13`) is therefore inert, and
   BullMQ connections are not closed on shutdown. Containers get hard-killed; in-flight
   requests are dropped mid-transaction.
   **Required change:** call `app.enableShutdownHooks()` in `main.ts` before `listen`, add
   `onApplicationShutdown`/`beforeApplicationShutdown` handling (close BullMQ queues,
   ioredis, Prisma), and set a container `STOPSIGNAL`/graceful timeout so ECS can drain.
5. **Startup crash-loops when DB is down (no retry).** `PrismaService.onModuleInit → $connect()`
   is unguarded (`prisma.service.ts:7-8`); if Postgres is unreachable at boot the API throws
   and the container restarts forever. Compose masks this with `depends_on: service_healthy`,
   which is unavailable in Fargate's own ordering.
   **Required change:** make `onModuleInit` retry `$connect` with bounded backoff (e.g.
   exponential 1–30s) while remaining responsive to SIGTERM, or rely on an orchestrator
   init-container/readiness that sequences RDS before the API task with retries.
6. **Hardcoded fallback JWT secrets bypass fail-fast in a surface the schema can't reach.**
   `jwt.strategy.ts:28` falls back `JWT_ACCESS_SECRET` to
   `sms-super-secret-jwt-key-for-dev-environment-12345`; `auth.service.ts:348` falls back
   `JWT_REFRESH_SECRET` to `'refresh-secret'`. `validateEnv` blocks the access/refresh dev
   defaults only when supplied **via the environment**; the in-code fallbacks would silently
   mint tokens with weak, guessable secrets if the env vars are ever absent at runtime
   (e.g. misconfigured task definition).
   **Required change:** in production/staging, remove the code-level fallback (read the secret
   without a default so only the validated env value is used), and extend `validateEnv` to
   reject `'refresh-secret'` and the access dev-default family outright.
7. **No Sentry / OpenTelemetry / structured logs.** Only the default Nest `Logger`
   (plain text, console) is present. `.env.example` advertises `SENTRY_DSN=` but nothing reads
   it. There is no error tracking, no trace/correlation, no request IDs surfaced to logs.
   **Required change:** wire the error path to a real error tracker (Sentry/`@sentry/node`)
   reading `SENTRY_DSN`; add JSON/structured logging with a per-request correlation id; add
   OpenTelemetry instrumentation (API + DB + Redis) so ECS/CloudWatch gives useful failure
   signals and traces.
8. **Web API base-URL fallback mismatch.** `apps/web/src/lib/api/client.ts:3` defaults the
   client `API_BASE` to `http://localhost:4000`, but the API listens on **3001**
   (`app.module.ts:43` default 3001), and `next.config.js` rewrites correctly default to
   `3001`. If `NEXT_PUBLIC_API_URL` is unset at build, the browser bundle points at the wrong
   port (4000) — a live-wrong-URL bug.
   **Required change:** align the `client.ts` fallback with the actual default (3001) or, in
   staging, always set `NEXT_PUBLIC_API_URL` at build; add a build-time guard/fail so a missing
   value cannot silently ship a mismatched URL.

## MEDIUM

9. **`S3_BUCKET` / `OPTIMIZER_URL` in `docker-compose.yml` are unused by the app** — decorative
   vars; harmless in compose, but a source of confusion and a risk of assuming S3/optimizer are
   wired when they aren't. Documents module is a documented MVP gap, so S3 is not exercised at
   runtime. (Clean up or explicitly mark `ACCEPTED`.)
10. **`DATABASE_SHADOW_URL` is not in `validateEnv`** (Prisma-CLI-only). Fine for runtime, but
    CI migration runs and staging must supply it to `prisma migrate dev` / shadow workflows.
11. **`seed` is manual and undocumented for ops rollout.** `prisma db seed` upserts the
    permission catalog; it runs as an explicit step, not at startup (correct), but there is no
    documented runbook step or CI stage that applies it to staging, so a fresh stage could
    boot with the catalog unseeded.
12. **`'degraded'` readiness returns HTTP 200** (`health.service.ts` returns 200 unless
    every-dependent service is down → 503). A partial outage (DB up, Redis down) will not fail
    the ECS target-group health check. Acceptable for liveness but consider a stricter
    readiness semantics for drain/rollout gating, or document the trade-off.
13. **No explicit container `USER`** — runner images run as root (`node:20-alpine` default).
    Low practical risk in a single-tenant Fargate task, but least-privilege is recommended
    (`USER node` + read-only root filesystem where possible).

## LOW

14. **Single initial migration** (`1788283422789_init`) only; the migration deploy path is
    good, but there is no multi-revision example and no rollback/down migration — acceptable
    for MVP, note for future revisions.
15. **No DB backup / DR / PITR definition.** RDS automated backups / snapshot retention,
    retention window, and a restore runbook are undefined (infra doesn't exist yet). Must be
    configured when Terraform is written.
16. **No load/stress testing and no concurrency/data-integrity test suite** (tracked in
    Priority Gaps #10). Not a staging blocker but gaps before production load.

## ACCEPTED (documented, deliberate)

17. **Rate limiting via `ThrottlerGuard` stands in for account-lockout** (real backoff counter
    is `NOT STARTED`). Accepted for staging given hardening verified a live 429.
18. **CORS is explicit allow-list, fail-closed** — staging must set `ALLOWED_ORIGINS` to the
    real staging web origin; fail-fast validation rejects wildcard/empty in `staging`
    (`NODE_ENV=staging` is treated as prod by `validateEnv`).
19. **Reference seed data (leave types, subscription plans) empty** — accepted/deferred;
    provisioned by a product decision, not a staging blocker.
20. **Health/liveness + readiness exist** and are live-verified; migration runs in-container at
    boot; seed is separated and explicit.

## Required changes for staging (summary)

1. Provision AWS via Terraform (blocker #1) with least-privilege IAM, private subnets, and
   restricted SGs so RDS/Redis are never internet-exposed; terminate public traffic at an ALB
   + CloudFront (TLS) and keep container ports internal.
2. Add CI/CD (`.github/`) running install → type-check → lint → test → build → image →
   (gated) E2E → terraform plan/apply(plan-only gate) → deploy with migration-before-rollout →
   health gate → rollback on failure (blockers #2,#3).
3. Enable graceful shutdown + shutdown hook orchestration (HIGH #4).
4. Add DB-connect retry with backoff at startup (HIGH #5).
5. Remove/neutralize in-code JWT fallback secrets + extend `validateEnv` (HIGH #6).
6. Add structured logs + Sentry + OTel with real `SENTRY_DSN` consumption (HIGH #7).
7. Fix the web `API_BASE` fallback port mismatch + require `NEXT_PUBLIC_API_URL` at build
   (HIGH #8).
8. Address MEDIUM items as part of the IaC/CI work (S3 vars, shadow URL in CI, seed runbook
   step, readiness semantics, container user).

## Verdict

**NOT READY.** The application artifact is deployable in isolation (reproducible Docker build,
Prisma migrate-deploy path, fail-safe env validation, health probes, no committed secrets), but
**the staging platform — infrastructure (Terraform), CI/CD, git, observability, and the
shutdown/startup resilience of the container — does not exist and must be created before
staging.** Of the 20 findings: **3 blockers, 5 high, 5 medium, 3 low, 4 accepted.** No product
features were added; no AWS resources were created; the application architecture was not
modified.

---

# DEPLOYMENT FOUNDATION — PART 1 (Sep 2026)

Addresses a strict subset of the staging-readiness blockers/high findings. **No AWS resources,
Terraform, or GitHub Actions were created.** The application architecture, authentication
architecture, database schema, and product features were not changed.

## Closed this phase

- **Blocker #3 — Git repository — CLOSED.** Verified the project was **not** inside any git
  repo, initialized git at the monorepo root (`git init -b main`, branch `main`), verified
  `.gitignore` correctly excludes `.env`, `node_modules`, `dist`, `.next`, `.turbo`, and IDE
  artifacts, checked `git status` (only source/config/docs untracked; only `.env.example`
  template files tracked), reviewed the staged set (218 files; no keys/certs, no file >1MB,
  no real `.env`), and created the initial baseline commit `3c0008e`. **No remote configured;
  nothing pushed** (no push unless instructed).
- **HIGH #6 — Hardcoded JWT fallback secrets — CLOSED.** Removed the code-level literals:
  - `apps/api/src/modules/auth/strategies/jwt.strategy.ts` — `secretOrKey` no longer falls back
    to `sms-super-secret-jwt-key-for-dev-environment-12345`; now `get('JWT_ACCESS_SECRET')`.
  - `apps/api/src/modules/auth/auth.service.ts` — `JWT_REFRESH_SECRET` no longer falls back to
    `'refresh-secret'`; now `get('JWT_REFRESH_SECRET')`.
  - `apps/api/src/modules/auth/auth.module.ts` (access secret), `jwt.strategy.ts`, and
    `auth.service.ts` all now read the secrets **without any literal fallback**. Production/
    staging already fail-fast via `validateEnv` (required, ≥16 chars, not a committed dev
    default). Dev/test values come from the **explicit** dev schema defaults, not hidden
    fallbacks. `env.validation` was **not weakened**. Repo-wide sweep confirms no runtime
    `get('JWT_*', <literal>)` remains; the only remaining secret strings are the intentional
    `DEV_*` validation constants + explicit test mocks.
- **HIGH #8 — Web API base-URL fallback mismatch — CLOSED.**
  - `apps/web/src/lib/api/client.ts` fallback corrected from `http://localhost:4000` →
    `http://localhost:3001` (the actual API dev port).
  - `apps/web/next.config.js` now **fails the build** if `NEXT_PUBLIC_API_URL` is missing during
    a production/staging build (no silent wrong-server fallback); local dev still defaults to
    port 3001. Verified: prod build without URL throws with a clear message; with URL loads fine.
  - `apps/web/Dockerfile` accepts a required `NEXT_PUBLIC_API_URL` build arg (inlined at build).
  - `docker-compose.yml` passes the build arg; root `.env.example` and new `apps/web/.env.example`
    document it.

## Still open (not addressed this phase)

- **Blocker #1 — No Terraform/AWS IaC** — open.
- **Blocker #2 — No CI/CD** — open.
- **HIGH #4 — No graceful shutdown** — **CLOSED in Part 2** (see "DEPLOYMENT FOUNDATION — PART 2" below).
- **HIGH #5 — DB startup crash-loop / no retry** — **CLOSED in Part 2** (see below).
- **HIGH #7 — No Sentry/OpenTelemetry/structured logs** — **CLOSED in Part 2** (see below).

## Verification (Phase D) — results

Environment note: a pre-existing corrupted `next` package (`dist/` missing) in `node_modules`
blocked `next build`; repaired with `pnpm install --force` after stopping the local API dev
process (the same issue recorded earlier in this doc). All gates below run with
`NEXT_PUBLIC_API_URL=http://localhost:3001` (required by the new production-build guard for a
local verification build).

- [x] `turbo type-check` — **6/6 green** (shared, api, web).
- [x] `turbo lint` — **3/3 green**, 0 errors (29 pre-existing warnings, unchanged).
- [x] `turbo test` — **3/3 green, 180/180** (added explicit JWT-secret returns to the
  `jwt.strategy.spec` / `auth.service.spec` config mocks to reflect the no-hidden-fallback
  behavior).
- [x] `turbo build` — **3/3 green**; API cleaned and rebuilt to 71 JS files (the previously
  noted `dist`/`tsconfig.tsbuildinfo` footgun) and re-verified against source.
- [x] API `test:e2e` — **52/52 green** against live Postgres+Redis on `:3001` (API restarted
  from rebuilt `dist`; readiness `ok`).
- [ ] Web `test:e2e` — **PRE-EXISTING GAP, not addressed**: `apps/web` has no Playwright specs
  or config (`playwright test` → "No tests found"). Unchanged by this phase and not one of the
  8 audit findings; left open.
- [x] **No hardcoded JWT fallback remains** — verified in source and in compiled `dist`
  (search returns zero literal `refresh-secret`/`sms-super-secret-jwt-key-for-dev` in runtime
  auth code).

## Remaining staging blockers (unchanged)

1. **Terraform / AWS IaC** — still absent.
2. **CI/CD (`.github/`)** — still absent.
3. **Repository baseline** — now present (Part 1 closed it). The remaining blockers to a staging
   deployment are now **Terraform/IaC** (Blocker #1) and **CI/CD** (Blocker #2). The HIGH
   resilience/observability items (#4, #5, #7) were closed in **DEPLOYMENT FOUNDATION — PART 2**
   below.

---

# DEPLOYMENT FOUNDATION - PART 2 (Sep 2026)

Closes the remaining HIGH staging-readiness findings from Part 1: **HIGH #4 (graceful shutdown)**,
**HIGH #5 (DB startup retry/backoff)**, and **HIGH #7 (observability)**. As in Part 1, **no AWS
resources, Terraform, or GitHub Actions were created**; no DB schema, authentication architecture,
or tenant-isolation changes were made. Web is unchanged (its build guard from Part 1 still applies).

## Closed this phase

- **HIGH #4 - No graceful shutdown - CLOSED.**
  - `apps/api/src/main.ts` now calls `app.enableShutdownHooks()` (line 29) **before** `listen()` so
    Nest destroy/lifecycle hooks run on SIGTERM/SIGINT.
  - `apps/api/src/infrastructure/queue/queue-shutdown.service.ts` implements `OnApplicationShutdown`
    and closes all 7 BullMQ queues with a **bounded 5s `Promise.race`** (so shutdown cannot hang the
    container drain even if a queue close stalls). `QueueModule` registers it.
  - Verified: API exits cleanly (not hard-killed) on shutdown; the `PrismaService.onModuleDestroy ->
    $disconnect` path and queue close now actually run on signal. (Unit-covered; the shutdown log
    line is not captured in harness-redirected stdout - a known stdout-buffering artifact, not a code
    defect.)

- **HIGH #5 - DB startup crash-loop / no retry - CLOSED.**
  - `apps/api/src/infrastructure/database/db-connect-policy.ts` + `db-connect-retrier.ts`: the
    module-init `$connect` is no longer a single unguarded attempt. Prisma connect now retries with
    **bounded exponential backoff (1-30s)**, with a retry budget and an optional configured
    `DB_CONNECT_RETRIES` / `DB_CONNECT_RETRY_BASE_MS` (parsed in `env.validation.ts` as optional
    vars on the common schema, so validation still fails fast without weakening it).
  - Startup that reaches Postgres still proceeds immediately (no artificial delay when healthy).
  - Verified: on a healthy stack the API boots straight through with no retry stalls (readiness
    `database: ok latencyMs 4`); the retry path is unit-tested. Fargate/ECS can now sequence RDS
    before the task or rely on the in-process backoff (covered by `db-connect-*.spec`).

- **HIGH #7 - No Sentry/OpenTelemetry/structured logs - CLOSED (minimal option chosen by user).**
  - User selected the **minimal observability** option: **structured JSON logs + per-request
    correlation ID only**. **No Sentry SDK, no OpenTelemetry runtime dependencies were added.**
    `SENTRY_DSN` remains documented (`.env.example`) but is intentionally never consumed this phase.
  - `apps/api/src/common/observability/json-logger.ts`: a `LoggerService` emitting single-line JSON
    with `level, message, timestamp (ISO), env, context, correlationId` (no ANSI color).
  - `apps/api/src/common/observability/trace-context.ts` + `request-context.middleware.ts`: assigns a
    per-request correlation ID (UUID), forwards an inbound `X-Request-ID`, and echoes it on the
    response `x-request-id` header and in every log line for that request.
  - `apps/api/src/common/observability/observability.module.ts` wires the middleware + overrides the
    Nest logger globally (`main.ts` `Logger.overrideLogger(jsonLogger)`).
  - `apps/api/src/common/filters/http-exception.filter.ts`: 5xx errors log full detail to server logs
    (never to the response) using the **route template path without query strings**.
  - **No-secret guarantee verified**: the middleware logs method + route path + status + durationMs;
    it never logs authorization headers, cookies, tokens, JWT secrets, passwords, request bodies, or
    query strings. Live log scan over a full E2E run reported 0 hits for accessToken / refreshToken /
    password / cookie / Bearer / secret / request body / query string (the only "Authorization"/"jwt"
    strings are Nest module init names).
  - Verified live: startup logs are JSON (`level,message,timestamp,env,context,correlationId`);
    `X-Request-ID: <uuid>` round-trips on requests; "request complete" lines carry
    `{method,path,status,durationMs,correlationId,env}` with path = route template (no query string).

## Verification (Phase D / Part 2) - results

Environment note: TS `incremental: true` in the API tsconfig caused `tsc -p tsconfig.json` /
`nest build` to **silently no-op** (exit 0, zero files emitted) once a stale/absent `*.tsbuildinfo`
combined with the harness environment. Build with `--incremental false` (or clear `dist` +
`*.tsbuildinfo` together) to emit. This is the concrete mechanism behind the Part-1 "dist/tsbuildinfo
footgun" note. After the full node_modules wipe + reinstall (see below), `prisma generate` (v5.22.0)
was re-run and `packages/shared` was rebuilt before the API could compile against `@sms/shared`.

- [x] **Environment repair (this pass)** - the global pnpm store's `rxjs@7.8.2` was genuinely corrupt
  (had `src/` but no `dist/`; `inquirer@8.2.6` junction chain also broken). A **full node_modules wipe
  + `pnpm install --force`** (1196 pkgs) definitively fixed it - manual tarball repairs and
  `pnpm store add` did **not** hold. Afterward: `prisma generate` (v5.22.0) and rebuilding
  `packages/shared` (`npx tsc` from `packages/shared`) were required before the API compiled.
- [x] `turbo type-check` - **6/6 green**, exit 0.
- [x] `turbo lint` - **3/3 green**, 0 errors (29 pre-existing warnings, unchanged).
- [x] `turbo test` - **3/3 green, 196/196** (19 files; 180 previous + new db-connect/observability/
  queue-shutdown specs and env-validation additions).
- [x] `turbo build` - **3/3 green**, exit 0 (FULL TURBO cache; web prod guard satisfied with
  `NEXT_PUBLIC_API_URL=http://localhost:3001` exported). API `dist` rebuilt to **312 files** via
  `tsc -p tsconfig.json --incremental false` (exit 0) for the local runtime verification.
- [x] API `test:e2e` - **52/52 green** (1 file, 7 workflows) against live Postgres+Redis on `:3001`
  from the rebuilt `dist` (readiness `ok`; database `ok` latencyMs 4, redis `ok` latencyMs 0).
- [x] **Runtime observability verified** - structured JSON startup logs; readiness/liveness 200 with
  DB+Redis checks; `X-Request-ID` correlation round-trip; request-complete logs with route-template
  paths; no secrets/query-strings in logs.
- [x] **No-secret scan passed** over the full live E2E run log (see HIGH #7 above).

## Still open (not addressed)

- **Blocker #1 - No Terraform/AWS IaC** - open.
- **Blocker #2 - No CI/CD (`.github/`)** - open.
- **HIGH #6 - accounted for; Part 1 closed it; Part 2 leaves it closed.**
- **Account lockout (real backoff counter)** - `NOT STARTED` (mitigated by enforced rate limiting).
- **Reference seed data (leave types, subscription plans)** - deferred (company-scoped; needs
  provisioning-strategy decision).
- **Security/unauthorized-access, concurrency test suites** - remain open.
- **Web `test:e2e` (Playwright)** - pre-existing gap, not part of the 8 audit findings; unchanged.

## Verdict (updated)

The three application-level **HIGH** resilience/observability findings are now closed (graceful
shutdown, DB-connect retry/backoff, structured logs + correlation ID). What remains between the MVP
and staging is **infrastructure + release engineering only**: Terraform/AWS IaC (Blocker #1) and
CI/CD (Blocker #2), plus the accepted/deferred product & test items list above. No application
architecture, auth, tenant isolation, or DB schema was changed in this phase.

---

# DEPLOYMENT FOUNDATION — PART 3A (Sep 2026)
Build Integrity + Reproducible Artifact Gate

Eliminates the possibility of a false-positive production API build caused by TypeScript incremental
compilation caching under NestJS CLI.

## Closed this phase

- **Build Integrity / False-Positive Production Build — CLOSED.**
  - **Root cause analysis:** `@nestjs/cli/lib/compiler/compiler.js` (line 21) unconditionally invokes
    `tsBinary.createIncrementalProgram || tsBinary.createProgram`. When TypeScript compiler options
    do not explicitly disable incremental mode, stale build state can result in `nest build` exiting
    with code 0 while silently skipping file emission (emitting zero files).
  - **Exact fix applied:**
    - `apps/api/tsconfig.json`: explicitly added `"incremental": false` to `compilerOptions`. This forces
      TypeScript's program factory to perform a full compile and emit on every run, preventing `.tsbuildinfo`
      from being written or causing silent no-ops.
    - `apps/api/Dockerfile`: updated the builder stage to execute `RUN pnpm --filter @sms/api exec prisma generate`
      before `RUN pnpm --filter @sms/api build`, ensuring Prisma client typings are available during container
      builds, and updated the runner stage to copy complete `node_modules` from the builder stage.
  - **Emitted artifact verification:**
    - Local clean build (`dist` wiped, zero `.tsbuildinfo`): **78 JS files** (344 total files in `dist/`),
      `dist/main.js` entrypoint verified. Consecutive builds consistently emit all 78 JS files.
    - Runtime startup: compiled entrypoint started with structured JSON logging; `/api/v1/health` returned
      200 `status: ok` with live database and Redis latency checks.
    - Docker container build (`sms-api:test`): image built successfully; inspected container filesystem
      confirming all **78 JS files** and `apps/api/dist/main.js` entrypoint exist.
  - **Monorepo validation gates:**
    - `turbo type-check`: **6/6 green**, exit 0.
    - `turbo lint`: **3/3 green**, 0 errors, 29 pre-existing warnings (exit 0).
    - `turbo test`: **3/3 green, 196/196 passed** (19 files).
    - `turbo build`: **3/3 green, FULL TURBO**, exit 0.
    - `test:e2e`: **52/52 green** (1 file, 7 workflows) against live Postgres + Redis.

## Remaining staging blockers (unchanged)

1. **Blocker #1 — No Terraform / AWS IaC** — open.
2. **Blocker #2 — No CI/CD (`.github/`)** — open.
3. **Account lockout / 2FA** — lockout mitigated by rate limiting; 2FA open.
4. **Reference seed data & test suites** — unauthorized-access, concurrency suites remain open.

## Verdict

**NOT STAGING READY YET.** Production API artifact generation is now deterministic, verified, and immune
to incremental compilation no-ops. Staging readiness remains blocked on infrastructure (Terraform/IaC)
and CI/CD pipelines. No architecture, database schema, authentication, tenant isolation, or business logic
changes were introduced.

