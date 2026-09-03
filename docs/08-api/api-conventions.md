# API Conventions

## General

- JSON
- ISO 8601 timestamps
- consistent pagination
- consistent error envelope
- request IDs
- idempotency for mutation endpoints that may be retried
- optimistic concurrency for important editable resources

## Errors

Return machine-readable error codes plus human-readable messages.

## Versioning

Breaking changes require a new API version.
