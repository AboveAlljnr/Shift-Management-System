// ============================================================
// Core domain types shared across API and Web
// Aligned with ADR-001 through ADR-008
// ============================================================

// ---- Primitive helpers ----
export type UUID = string;
export type ISODateString = string;
export type Pagination = { page: number; limit: number; total: number };

// ---- Company (Tenant Root - ADR-001) ----
export type CompanyStatus = 'active' | 'suspended' | 'trial' | 'cancelled';

export interface Company {
  id: UUID;
  name: string;
  slug: string;
  logoUrl?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  timezone: string;
  contactEmail?: string;
  contactPhone?: string;
  industry?: string;
  size?: string;
  status: CompanyStatus;
  settings?: Record<string, unknown>;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// ---- Users, Membership & Auth (ADR-002, ADR-004) ----
export type UserRole = 'super_admin' | 'admin' | 'manager' | 'shift_manager' | 'employee';
export type UserStatus = 'active' | 'suspended' | 'pending_verification';
export type MembershipStatus = 'invited' | 'active' | 'suspended' | 'revoked';
export type ScopeType = 'company' | 'branch' | 'department' | 'team' | 'self';
export type OverrideType = 'grant' | 'revoke';

export interface User {
  id: UUID;
  email: string;
  name: string;
  status: UserStatus;
  emailVerifiedAt?: ISODateString;
  twoFactorEnabledAt?: ISODateString;
  lastLoginAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CompanyMembership {
  id: UUID;
  userId: UUID;
  companyId: UUID;
  status: MembershipStatus;
  invitedAt: ISODateString;
  joinedAt?: ISODateString;
  revokedAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface CompanyContext {
  userId: UUID;
  companyId: UUID;
  membershipId: UUID;
  roles: string[];
  permissions: string[];
  scopes: { scopeType: ScopeType; scopeId: string }[];
}

// ---- Organization (ADR-003) ----
export interface Branch {
  id: UUID;
  companyId: UUID;
  name: string;
  code: string;
  timezone: string;
  isActive: boolean;
}

export interface Department {
  id: UUID;
  companyId: UUID;
  branchId: UUID;
  name: string;
  code: string;
  managerId?: UUID;
  isActive: boolean;
}

export interface Team {
  id: UUID;
  companyId: UUID;
  departmentId: UUID;
  name: string;
  code: string;
  managerId?: UUID;
  isActive: boolean;
}

export interface EmploymentType {
  id: UUID;
  companyId: UUID;
  name: string;
  code: string;
  isActive: boolean;
}

export interface Position {
  id: UUID;
  companyId: UUID;
  departmentId?: UUID;
  name: string;
  code: string;
  isActive: boolean;
}

export interface Skill {
  id: UUID;
  companyId: UUID;
  name: string;
  code: string;
  isActive: boolean;
}

export interface Certification {
  id: UUID;
  companyId: UUID;
  name: string;
  code: string;
  validityPeriodDays?: number;
  isActive: boolean;
}

// ---- Employee (ADR-002) ----
export type EmployeeStatus = 'active' | 'inactive' | 'on_leave' | 'terminated';

export interface Employee {
  id: UUID;
  companyId: UUID;
  userId?: UUID;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  employmentTypeId: UUID;
  status: EmployeeStatus;
  branchId?: UUID;
  departmentId?: UUID;
  teamId?: UUID;
  primaryPositionId?: UUID;
  managerId?: UUID;
  hireDate: ISODateString;
  terminationDate?: ISODateString;
  profilePhotoUrl?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// ---- Scheduling (ADR-005, ADR-006) ----
export type ShiftStatus = 'draft' | 'review' | 'approved' | 'published' | 'cancelled';
export type ScheduleStatus = 'draft' | 'published' | 'locked';
export type AssignmentStatus = 'scheduled' | 'confirmed' | 'swapped' | 'dropped' | 'cancelled';
export type ConflictSeverity = 'WARNING' | 'BLOCKING';
export type SwapRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'approved';
export type OpenShiftStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type OptimizationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
export type OptimizationPath = 'interactive' | 'async';

export interface Shift {
  id: UUID;
  companyId: UUID;
  scheduleId?: UUID;
  branchId: UUID;
  departmentId?: UUID;
  teamId?: UUID;
  name: string;
  startAt: ISODateString;
  endAt: ISODateString;
  isOvernight: boolean;
  isRecurring: boolean;
  recurrenceRule?: string;
  status: ShiftStatus;
  notes?: string;
  attachmentUrls: string[];
  publishedAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ShiftAssignment {
  id: UUID;
  shiftId: UUID;
  employeeId: UUID;
  status: AssignmentStatus;
  confirmedAt?: ISODateString;
  notes?: string;
}

export interface ShiftConflictOverride {
  id: UUID;
  companyId: UUID;
  shiftId: UUID;
  employeeId?: UUID;
  ruleIdentifier: string;
  severity: ConflictSeverity;
  reason: string;
  overriddenById: UUID;
  overriddenAt: ISODateString;
  metadata?: Record<string, unknown>;
}

export interface Schedule {
  id: UUID;
  companyId: UUID;
  branchId?: UUID;
  name: string;
  periodStart: ISODateString;
  periodEnd: ISODateString;
  status: ScheduleStatus;
  createdById: UUID;
  publishedAt?: ISODateString;
  lockedAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ScheduleVersion {
  id: UUID;
  scheduleId: UUID;
  versionNumber: number;
  snapshotJson: Record<string, unknown>;
  publishedById: UUID;
  publishedBy?: { id: UUID; name: string; email: string };
  publishedAt: ISODateString;
  notes?: string;
}

export interface AvailabilityRule {
  id: UUID;
  employeeId: UUID;
  companyId: UUID;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  effectiveFrom: ISODateString;
  effectiveTo?: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface AvailabilityException {
  id: UUID;
  employeeId: UUID;
  companyId: UUID;
  date: ISODateString;
  isAvailable: boolean;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
  createdAt: ISODateString;
}

export interface ShiftCoverage {
  shiftId: UUID;
  headcountRequired: number;
  headcountFilled: number;
  shortfall: number;
  covered: boolean;
  overstaffed: boolean;
}

export interface SchedulePublishResult {
  success: boolean;
  versionNumber: number;
  publishedAt: ISODateString;
}

export interface OptimizationRequest {
  id: UUID;
  companyId: UUID;
  requestedById: UUID;
  parameters: Record<string, unknown>;
  status: OptimizationStatus;
  path: OptimizationPath;
  idempotencyKey: string;
  resultJson?: Record<string, unknown>;
  startedAt?: ISODateString;
  completedAt?: ISODateString;
  createdAt: ISODateString;
}

// ---- Attendance ----
export type AttendanceRecordStatus =
  | 'present'
  | 'late'
  | 'absent'
  | 'on_leave'
  | 'holiday'
  | 'day_off'
  | 'missing_clock_in'
  | 'missing_clock_out'
  | 'early_departure'
  | 'overtime'
  | 'half_day';

export type AttendanceEventType =
  | 'clock_in'
  | 'clock_out'
  | 'break_start'
  | 'break_end'
  | 'correction'
  | 'manual_override';

export type AttendanceEventSource = 'mobile' | 'web' | 'device' | 'offline_sync';

export interface AttendanceRecord {
  id: UUID;
  companyId: UUID;
  employeeId: UUID;
  shiftAssignmentId?: UUID;
  workDate: ISODateString;
  status: AttendanceRecordStatus;
  effectiveClockIn?: ISODateString;
  effectiveClockOut?: ISODateString;
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface AttendanceEvent {
  id: UUID;
  attendanceRecordId: UUID;
  companyId: UUID;
  employeeId: UUID;
  eventType: AttendanceEventType;
  clientOccurredAt: ISODateString;
  serverReceivedAt: ISODateString;
  source: AttendanceEventSource;
  deviceIdentifier?: string;
  idempotencyKey: string;
  latitude?: number;
  longitude?: number;
  geofenceResult?: string;
  metadata?: Record<string, unknown>;
}

// ---- Geofence enforcement (configurable, ADR-003) ----
export type GeofenceEnforcementMode = 'strict' | 'warning' | 'off';

export interface GeofenceEnforcementConfig {
  /** How the clock-in event is enforced against an active branch geofence. */
  mode: GeofenceEnforcementMode;
  /**
   * strict: outside an active geofence -> clock-in rejected (GEOFENCE_OUTSIDE).
   * warning: outside -> clock-in accepted but flagged (verified=false, geofenceWarning).
   * off: geofence enforcement skipped for clock-in entirely.
   */
  allowMissingLocation?: boolean;
}

// ---- Leave ----
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveType {
  id: UUID;
  companyId: UUID;
  name: string;
  code: string;
  isPaid: boolean;
  defaultEntitlementDays: number;
  carryOverLimit: number;
  isActive: boolean;
}

export interface LeaveRequest {
  id: UUID;
  companyId: UUID;
  employeeId: UUID;
  leaveTypeId: UUID;
  startDate: ISODateString;
  endDate: ISODateString;
  requestedDays: number;
  status: LeaveStatus;
  reason?: string;
  reviewedById?: UUID;
  reviewedAt?: ISODateString;
  reviewNote?: string;
  createdAt: ISODateString;
}

// ---- Billing (ADR-008) ----
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'suspended';

export interface Subscription {
  id: UUID;
  companyId: UUID;
  planId: UUID;
  status: SubscriptionStatus;
  currentPeriodStart: ISODateString;
  currentPeriodEnd: ISODateString;
  trialEndsAt?: ISODateString;
}

// ---- Notifications ----
export type NotificationChannel = 'in_app' | 'email' | 'push';

export interface Notification {
  id: UUID;
  companyId: UUID;
  recipientId: UUID;
  channel: NotificationChannel;
  eventType: string;
  title: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  isRead: boolean;
  readAt?: ISODateString;
  createdAt: ISODateString;
}

// ---- API Conventions ----
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiListResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface ApiError {
  statusCode: number;
  message: string;
  errors?: Record<string, string[]>;
  timestamp: ISODateString;
  path: string;
}
