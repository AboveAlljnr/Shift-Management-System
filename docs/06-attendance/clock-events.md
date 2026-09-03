# Clock Events

Use immutable event records as the source of truth.

Each event should include:

- id
- employee_id
- event_type
- occurred_at_client
- received_at_server
- source
- device/client identifier
- latitude/longitude when applicable
- geofence result
- idempotency key
- sync state
- metadata

Server normalization produces the current attendance state.
