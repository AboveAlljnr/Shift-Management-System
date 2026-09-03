# Database Schema

The canonical entity list. All entities use `companyId` as the foreign key to the tenant root (never `tenantId`). See `01-architecture/architecture-decisions.md`.

---

## Core identity

### companies
- id
- name
- slug (globally unique)
- logoUrl
- address fields
- country
- timezone
- contactFields
- industry
- size
- status (active, suspended, trial, cancelled)
- createdAt, updatedAt

### users
- id
- email (globally unique — no companyId on User)
- passwordHash
- name
- status (active, suspended, pending_verification)
- emailVerifiedAt (nullable)
- twoFactorSecret (nullable, encrypted)
- twoFactorEnabledAt (nullable)
- lastLoginAt (nullable)
- createdAt, updatedAt

### company_memberships
- id
- userId
- companyId
- status (invited, active, suspended, revoked)
- invitedAt
- joinedAt (nullable)
- revokedAt (nullable)
- revokedBy (userId, nullable)
- createdAt, updatedAt
- UNIQUE(userId, companyId)

### refresh_tokens
- id
- userId
- tokenHash (unique)
- membershipId (nullable — if scoped to a company membership)
- expiresAt
- isRevoked
- deviceIdentifier (nullable)
- createdAt

### employees
- id
- companyId
- userId (nullable)
- employeeNumber
- firstName, lastName
- email (contact, not login)
- phone (nullable)
- dateOfBirth (nullable)
- emergencyContactName, emergencyContactPhone
- employmentTypeId
- branchId, departmentId, teamId
- primaryPositionId (nullable)
- managerId (nullable, self-reference within company)
- status (active, inactive, on_leave, terminated)
- hireDate
- terminationDate (nullable)
- profilePhotoUrl (nullable)
- createdAt, updatedAt
- UNIQUE(companyId, employeeNumber)

---

## Organization

### branches
- id, companyId, name, code, address fields, timezone, isActive, createdAt, updatedAt
- UNIQUE(companyId, code)

### departments
- id, companyId, branchId, name, code, managerId (employeeId nullable), isActive, createdAt, updatedAt
- UNIQUE(companyId, code)

### teams
- id, companyId, departmentId, name, code, managerId (employeeId nullable), isActive, createdAt, updatedAt
- UNIQUE(companyId, code)

### employment_types
- id, companyId, name, code, isActive

### positions
- id, companyId, name, code, departmentId (nullable), isActive
- UNIQUE(companyId, code)

### skills
- id, companyId, name, code, isActive

### certifications
- id, companyId, name, code, validityPeriodDays (nullable), isActive

---

## Authorization

### roles
- id, companyId (nullable — null = platform role for Super Admin), name, code, isSystemRole, isActive

### permissions
- id, action (e.g. schedule.publish), resource, description

### role_permissions
- id, roleId, permissionId
- UNIQUE(roleId, permissionId)

### user_roles
- id, membershipId, roleId
- UNIQUE(membershipId, roleId)

### user_permission_overrides
- id, membershipId, permissionId, type (grant | revoke), reason, grantedBy (userId), createdAt
- UNIQUE(membershipId, permissionId)

### access_scopes
- id, membershipId (or userRoleId), scopeType (company | branch | department | team | self), scopeId (uuid of the entity)
- Composite index on (membershipId, scopeType, scopeId)

---

## Workforce

### availability_rules
- id, employeeId, companyId, dayOfWeek, startTime, endTime, isAvailable, effectiveFrom, effectiveTo

### availability_exceptions
- id, employeeId, companyId, date, isAvailable, startTime, endTime, reason

### employee_skills
- id, employeeId, skillId, proficiencyLevel (nullable), verifiedAt, verifiedBy
- UNIQUE(employeeId, skillId)

### employee_certifications
- id, employeeId, certificationId, issuedAt, expiresAt, issuer, documentUrl
- UNIQUE(employeeId, certificationId)

### holidays
- id, companyId, name, date, branchId (nullable), isRecurring

### geofences
- id, companyId, branchId (nullable), name, latitude, longitude, radiusMeters, isActive

---

## Scheduling

### shift_templates
- id, companyId, name, startTime, endTime, branchId, departmentId, teamId, notes, isActive

### schedules
- id, companyId, branchId (nullable), name, periodStart, periodEnd, status (draft | published | locked), createdBy, publishedAt, lockedAt

### schedule_versions
- id, scheduleId, versionNumber, snapshotJson (full shift state at publish), publishedBy, publishedAt, notes

### shifts
- id, companyId, scheduleId (nullable), branchId, departmentId (nullable), teamId (nullable)
- name, startAt, endAt, isOvernight, isRecurring, recurrenceRule
- status (draft | review | approved | published | cancelled)
- notes, attachmentUrls
- publishedAt, publishedBy, approvedAt, approvedBy, lockedAt
- createdAt, updatedAt
- INDEX(companyId, startAt)
- INDEX(companyId, branchId, startAt)

### shift_requirements
- id, shiftId, headcount, positionId (nullable), branchConstraint (nullable)

### shift_requirement_skills
- id, requirementId, skillId

### shift_requirement_certifications
- id, requirementId, certificationId

### shift_assignments
- id, shiftId, employeeId, status (scheduled | confirmed | swapped | dropped | cancelled)
- confirmedAt, notes, createdAt, updatedAt
- UNIQUE(shiftId, employeeId)

### shift_conflict_overrides
- id, companyId, shiftId, employeeId (nullable)
- ruleIdentifier (e.g. MIN_REST, MAX_HOURS, AVAILABILITY)
- severity (WARNING | BLOCKING — only WARNING-level can be overridden)
- reason (required text)
- overriddenBy (userId)
- overriddenAt
- metadata (JSON)
- Append-only — never updated or deleted

### shift_history
- id, shiftId, changedBy (userId), changeType, before (JSON), after (JSON), occurredAt
- Immutable

### shift_swap_requests
- id, companyId, shiftId, requestingEmployeeId, targetEmployeeId (nullable), status, reason, createdAt, resolvedAt, resolvedBy

### open_shift_requests
- id, companyId, shiftId, employeeId, status, createdAt, resolvedAt, resolvedBy

### optimization_requests
- id, companyId, requestedBy (userId), parameters (JSON), status (pending | running | completed | failed | timeout)
- path (interactive | async)
- resultJson (nullable — stored when complete)
- idempotencyKey (unique per request)
- startedAt, completedAt, createdAt

---

## Attendance

### attendance_records
- id, companyId, employeeId, shiftAssignmentId (nullable), workDate
- status (present | late | absent | on_leave | holiday | day_off | missing_clock_in | missing_clock_out | early_departure | overtime | half_day)
- effectiveClockIn, effectiveClockOut (computed from events)
- totalWorkedMinutes, totalBreakMinutes
- createdAt, updatedAt
- UNIQUE(employeeId, workDate)
- INDEX(companyId, workDate)

### attendance_events
- id, attendanceRecordId, employeeId, companyId
- eventType (clock_in | clock_out | break_start | break_end | correction | manual_override)
- clientOccurredAt (client timestamp)
- serverReceivedAt
- source (mobile | web | device | offline_sync)
- deviceIdentifier, idempotencyKey (unique)
- latitude, longitude, geofenceResult (nullable)
- metadata (JSON)
- Immutable — no updates or deletes
- INDEX(employeeId, clientOccurredAt)

### breaks
- id, attendanceRecordId, employeeId, startAt, endAt (nullable), durationMinutes, isPaid, source, createdAt

### attendance_corrections
- id, attendanceRecordId, correctedBy (userId), field, previousValue, newValue, reason, occurredAt
- Append-only

---

## Leave and activities

### leave_types
- id, companyId, name, code, isPaid, defaultEntitlementDays, carryOverLimit, isActive

### leave_balances
- id, employeeId, leaveTypeId, companyId, year
- entitlementDays, usedDays, pendingDays, remainingDays (computed)
- createdAt, updatedAt
- UNIQUE(employeeId, leaveTypeId, year)

### leave_requests
- id, companyId, employeeId, leaveTypeId
- startDate, endDate, requestedDays
- status (pending | approved | rejected | cancelled)
- reason, reviewedBy (userId nullable), reviewedAt, reviewNote
- createdAt, updatedAt
- INDEX(companyId, status, startDate)

### activity_types
- id, companyId, name, code
- countsTowardHours, blocksShifts, requiresClockIn, countsTowardOvertime
- allowsEmployeeRequest, requiresApproval
- isRecurring, isActive

### activities
- id, companyId, activityTypeId, name, description
- startAt, endAt, recurrenceRule (nullable)
- isActive, createdAt, updatedAt

### activity_assignments
- id, activityId, employeeId, status, createdAt

---

## Documents and communication

### document_categories
- id, companyId, name, code, isActive

### documents
- id, companyId, employeeId (nullable — company-level documents have null employeeId)
- categoryId, name, expiresAt, status (active | expired | revoked)
- createdAt, updatedAt
- INDEX(employeeId, expiresAt)

### document_versions
- id, documentId, versionNumber, s3Key, fileSizeBytes, uploadedBy (userId), uploadedAt
- Latest version is current

### notifications
- id, companyId, recipientId (userId), channel (in_app | email | push)
- eventType, title, body, relatedEntityType, relatedEntityId
- isRead, readAt, deliveryStatus, deliveredAt
- createdAt
- INDEX(recipientId, isRead, createdAt)

### notification_preferences
- id, membershipId, channel, eventType, isEnabled

### announcements
- id, companyId, authorId (userId), title, body
- targetScope (company | branch | department | team), targetScopeId (nullable)
- publishedAt, expiresAt, createdAt

### announcement_acknowledgments
- id, announcementId, userId, acknowledgedAt

---

## Billing

### subscription_plans
- id, name, code, maxEmployees, priceMonthly, priceYearly, features (JSON), isActive

### subscriptions
- id, companyId, planId, status (trialing | active | past_due | cancelled | suspended)
- currentPeriodStart, currentPeriodEnd, trialEndsAt
- providerSubscriptionId (external billing provider reference)
- createdAt, updatedAt

### invoices
- id, subscriptionId, companyId, periodStart, periodEnd
- amountDue, amountPaid, currency, status (open | paid | void | uncollectable)
- providerInvoiceId, dueAt, paidAt, createdAt

### payments
- id, invoiceId, amount, currency, status, providerPaymentId, createdAt

### payment_attempts
- id, paymentId, attemptNumber, status, failureReason, attemptedAt

### billing_events
- id, subscriptionId, companyId, eventType, payload (JSON), occurredAt
- Append-only

### provider_webhook_events
- id, provider, eventId (unique per provider), eventType, payload (JSON), processedAt, status
- Idempotent: UNIQUE(provider, eventId)

---

## Platform

### audit_logs
- id, companyId (nullable for platform events), actorId (userId nullable), actorEmail
- action, resource, resourceId
- before (JSON nullable), after (JSON nullable)
- ipAddress, userAgent, requestId
- occurredAt
- Append-only
- INDEX(companyId, occurredAt)
- INDEX(resource, resourceId)

### outbox_events
- id, companyId (nullable), eventType, payload (JSON)
- status (pending | processing | published | failed)
- attempts, processedAt, error, createdAt
- INDEX(status, createdAt)

### feature_flags
- id, key, description, isEnabled, companyId (nullable — null = platform-wide), createdAt, updatedAt

### maintenance_windows
- id, description, startAt, endAt, affectedSystems, createdAt
