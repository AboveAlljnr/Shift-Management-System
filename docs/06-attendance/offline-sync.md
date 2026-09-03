# Offline Attendance Sync

Offline attendance requires idempotent event processing.

## Client payload

```text
client_event_id
employee_id
event_type
client_occurred_at
device_id
location
verification_data
created_at
```

## Server processing

1. Authenticate the user/device.
2. Validate tenant and employee.
3. Check idempotency key.
4. Preserve original client event.
5. Record server receipt time.
6. Validate attendance rules.
7. Normalize attendance state.
8. Return deterministic sync result.

Duplicate events must not create duplicate attendance actions.
Clock skew and conflicting offline events must be surfaced for reconciliation rather than silently discarded.
