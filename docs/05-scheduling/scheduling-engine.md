# Scheduling Engine

The scheduling engine is a **deterministic domain service**. It is the authoritative validator for all schedule operations.

## Single validation engine rule

Manual scheduling, recurring scheduling, copy-from-previous, AI-generated proposals, shift swap requests, and open shift requests must **all** pass through the same validation engine before being persisted or proposed to the manager. There is no "fast path" that bypasses constraint checking.

## Inputs

The engine receives and evaluates:

- employee eligibility (status = active, position match)
- availability rules and exceptions
- approved leave requests
- existing activities that block shifts
- working-hour limits (max per day, per week, per period)
- minimum rest requirements (configurable per company)
- skill requirements from `ShiftRequirement`
- certification requirements from `ShiftRequirement`
- branch/location constraints
- existing shift assignments (overlap detection)
- staffing requirements (headcount per requirement)
- public holidays

## Outputs

The engine always returns a structured result:

```text
ScheduleValidationResult {
  isValid: boolean
  conflicts: Conflict[]
  warnings: Conflict[]
  uncoveredRequirements: ShiftRequirementGap[]
  validAssignments: ShiftAssignment[]
}
```

## Conflict structure

See `05-scheduling/conflicts.md` for the full conflict entity definition.

## Rule defaults

Default conflict behavior is **warning + authorized manager confirmation**, not silent blocking.

Exception: a company-configured rule may explicitly set a conflict as `BLOCKING`, which prevents the assignment entirely. Only warnings can produce `ShiftConflictOverride` records.

## Constraint precedence

1. **BLOCKING constraints** (non-overridable): Cannot be overridden by any manager. Examples: overlapping published shifts (same employee, same time), missing required certification with no expiry grace.
2. **WARNING constraints** (override-allowed): Can be overridden with explicit manager confirmation and a reason. Override is recorded in `ShiftConflictOverride`. Examples: minimum rest violation, maximum hours approaching limit.

## Relationship to AI optimizer

The AI optimizer (OR-Tools / Python service) proposes schedule assignments. Every proposal is then passed through this validation engine before being presented to the manager. The optimizer does not replace or bypass validation.

See `05-scheduling/ai-scheduling.md`.
