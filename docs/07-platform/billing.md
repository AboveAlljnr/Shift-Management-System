# Billing

## Billing model

Billing is based on **Active Employee count** per company. See `01-architecture/architecture-decisions.md` ADR-008.

The billable unit is an `Employee` record with `status = active`. Authentication account count (`User` / `CompanyMembership`) is not the billing basis.

## Subscription plans

Each plan defines:

- `name`, `code`
- `maxEmployees` (seat limit)
- `priceMonthly`, `priceYearly`
- `features` (JSON: feature flag overrides per plan tier)
- Trial configuration (managed by `Subscription.trialEndsAt`)

## Lifecycle events

### Employee activation
- Seat consumed immediately.
- If current active employee count equals or exceeds `SubscriptionPlan.maxEmployees`:
  - Default: soft block — admin receives a warning and must upgrade before activating.
  - Configurable: hard block — activation is rejected until plan is upgraded or employee is freed.

### Employee deactivation
- Seat released.
- Effect on billing: next billing cycle (not retroactive).
- Retroactive credits are not issued in V1.

### Reactivation of a deactivated employee
- Seat re-consumed immediately.
- Same limit enforcement as initial activation.

## Trial

- Duration: 14 days (`Subscription.trialEndsAt`).
- Trial seat limit: defined by `SubscriptionPlan.trialEmployeeLimit` (may differ from paid plan limit).
- Trial expiry: triggers a 7-day grace period before hard access restriction.
- During grace period: employee-facing features are read-only; admin/owner can access billing to subscribe.

## Upgrades

- Plan upgrades are effective immediately.
- Additional seats are available immediately.
- Cost is prorated for the remainder of the current billing period.

## Downgrades

- Plan downgrades take effect at the end of the current billing period.
- If active employee count exceeds the new plan's `maxEmployees` at downgrade time, the admin must deactivate employees before the downgrade applies.
- The system warns the admin of the impending seat conflict during the downgrade selection.

## Grace period (payment failure)

- Failed payment triggers a grace period (default 7 days, configurable per plan).
- During grace period: employee read-only access; admin/owner retain billing access.
- After grace period expires without resolution: company is suspended (`Company.status = suspended`).
- Suspension is reversible on payment resolution.

## Provider abstraction

All billing operations go through `BillingService`. The service wraps a pluggable provider adapter. Swapping the billing provider (e.g. Stripe → Paddle) does not require changes to domain modules.

Provider webhook events are:
- Received at a dedicated webhook endpoint.
- Idempotent: `provider_webhook_events(provider, eventId)` is unique.
- Processed and recorded in `BillingEvent` (append-only).
- Auditable: billing changes are recorded in `AuditLog`.

## Entities involved

```text
Company
  └── Subscription (companyId, planId)
       └── SubscriptionPlan (platform-wide)
       └── Invoice (subscriptionId, companyId)
            └── Payment (invoiceId)
                 └── PaymentAttempt (paymentId)
       └── BillingEvent (append-only)
       └── ProviderWebhookEvent (idempotent, platform-level)
```
