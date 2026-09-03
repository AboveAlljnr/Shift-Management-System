# Conflict Engine

## Conflict structure

Conflicts are structured records, not free-form strings.

```text
Conflict {
  type: ConflictType       -- machine-readable (e.g. MIN_REST, MAX_HOURS, AVAILABILITY, OVERLAP)
  severity: BLOCKING | WARNING
  employeeId: string       -- nullable for shift-level conflicts
  shiftId: string
  relatedShiftId: string   -- nullable
  ruleIdentifier: string   -- references the specific rule that was violated
  message: string          -- human-readable summary
  overrideAllowed: boolean -- true only for WARNING severity
  metadata: JSON           -- additional context (e.g. restHoursRequired, restHoursActual)
}
```

## Conflict types (non-exhaustive)

| Type | Severity | Overridable |
|---|---|---|
| `OVERLAPPING_SHIFT` | BLOCKING | No |
| `MISSING_CERTIFICATION` | BLOCKING | No (configurable) |
| `MIN_REST` | WARNING | Yes |
| `MAX_HOURS_DAY` | WARNING | Yes |
| `MAX_HOURS_WEEK` | WARNING | Yes |
| `AVAILABILITY_RULE` | WARNING | Yes |
| `AVAILABILITY_EXCEPTION` | WARNING | Yes |
| `APPROVED_LEAVE` | BLOCKING | No |
| `POSITION_MISMATCH` | WARNING | Yes |
| `SKILL_MISSING` | WARNING | Yes |
| `STAFFING_UNDERCOVERAGE` | WARNING | Yes |
| `BRANCH_CONSTRAINT` | WARNING | Yes |

Companies may configure specific conflict types to escalate from WARNING to BLOCKING via scheduling rule settings.

## Overrides

When a manager explicitly overrides a WARNING conflict, a `ShiftConflictOverride` record is created.

```text
ShiftConflictOverride {
  id
  companyId
  shiftId
  employeeId (nullable)
  ruleIdentifier
  severity (always WARNING at time of override)
  reason               -- required text from the manager
  overriddenBy         -- userId of authorizing manager
  overriddenAt         -- timestamp
  metadata             -- JSON: includes rule values, constraint delta, related shift IDs
}
```

## Hard rules

1. BLOCKING constraints cannot be overridden by any user, including admins.
2. AI (OR-Tools optimizer or LLM) must never create a `ShiftConflictOverride`. Only a human manager with the `shift.conflict_override` permission may do so.
3. Override records are append-only and are never updated or deleted.
4. Overrides must be included in the `AuditLog`.
5. The manager must provide a non-empty reason for any override.
