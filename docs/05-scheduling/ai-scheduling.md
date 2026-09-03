# AI-Assisted Scheduling

AI scheduling is human-controlled. The deterministic scheduling engine is authoritative. AI assists the manager; it does not publish schedules autonomously.

## Execution paths

Two paths are available depending on optimization duration. See `01-architecture/architecture-decisions.md` ADR-006.

### Interactive path (synchronous, ≤ 30 seconds)

```text
Manager requests optimization via UI
  |
  v
NestJS API creates OptimizationRequest record (status: running, path: interactive)
  |
  v
HTTP POST to Python Optimizer (FastAPI + OR-Tools) — 30s timeout
  |
  v
OR-Tools CP-SAT solver produces assignment proposal
  |
  v
NestJS validates proposal through deterministic Scheduling Engine
  |
  v
Conflicts and warnings are annotated on the proposal
  |
  v
LLM generates human-readable explanation and alternative summary (optional)
  |
  v
OptimizationRequest record updated (status: completed, resultJson stored)
  |
  v
Proposed schedule returned to UI for manager review
```

### Async fallback path (> 30 seconds)

```text
30-second interactive timeout reached (not exceeded — job is queued before expiry)
  |
  v
NestJS enqueues job to BullMQ SCHEDULE_OPTIMIZATION queue
OptimizationRequest updated (status: pending, path: async)
Response to UI: 202 Accepted with requestId for polling
  |
  v
Python Optimizer worker picks up job
  |
  v
OR-Tools completes optimization (no time cap in async path)
  |
  v
NestJS validates proposal through Scheduling Engine
  |
  v
OptimizationRequest updated (status: completed, resultJson stored)
  |
  v
Manager notified via WebSocket (optimization.completed) + in-app notification
Manager polls GET /api/v1/schedule/optimize/{requestId} or receives push
  |
  v
Manager reviews proposal in UI
```

## Idempotency

Each optimization request carries a unique `idempotencyKey`. Re-submitting the same request returns the existing job status or result rather than starting a duplicate job.

## Human approval gate

All optimization results — whether from the interactive or async path — are proposals only. The manager must:

1. Review the proposed assignments
2. Inspect any flagged conflicts or warnings
3. Optionally edit the proposal manually
4. Explicitly approve and publish the schedule

AI can never publish a schedule. Human approval is always required.

## Responsibilities

### OR-Tools / deterministic engine

- Satisfy all hard constraints (availability, leave, certifications, overlap, hours)
- Optimize staffing coverage against soft objectives (headcount, fairness)
- Identify infeasible cases and return them with an explanation
- Respect company-configured scheduling rules

### LLM layer (optional, in NestJS)

- Interpret natural-language scheduling requests from the manager
- Explain why the optimizer made specific assignment decisions
- Summarize identified conflicts and warnings in plain language
- Describe alternative schedule proposals

**The LLM is never the authoritative validator. It never modifies schedule state directly.**

## OptimizationRequest entity

The `optimization_requests` table tracks both paths:

- `id`, `companyId`, `requestedBy` (userId)
- `parameters` (JSON: schedule period, constraints, employee pool)
- `status` (pending | running | completed | failed | timeout)
- `path` (interactive | async)
- `idempotencyKey` (unique)
- `resultJson` (nullable — stored when complete)
- `startedAt`, `completedAt`, `createdAt`
