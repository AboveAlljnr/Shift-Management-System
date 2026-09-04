// ---- Role and scope constants ----
export const USER_ROLES = ['super_admin', 'admin', 'manager', 'shift_manager', 'employee'] as const;
export const SCOPE_TYPES = ['company', 'branch', 'department', 'team', 'self'] as const;

export {
  PERMISSION_ACTIONS,
  ROLE_PERMISSION_TEMPLATES,
  getRolePermissionTemplate,
} from './permissions';

// ---- Company / Membership statuses ----
export const COMPANY_STATUSES = ['active', 'suspended', 'trial', 'cancelled'] as const;
export const MEMBERSHIP_STATUSES = ['invited', 'active', 'suspended', 'revoked'] as const;
export const USER_STATUSES = ['active', 'suspended', 'pending_verification'] as const;

// ---- Employment types ----
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contractor', 'casual'] as const;

// ---- Scheduling statuses & severities ----
export const SHIFT_STATUSES = ['draft', 'review', 'approved', 'published', 'cancelled'] as const;
export const SCHEDULE_STATUSES = ['draft', 'published', 'locked'] as const;
export const ASSIGNMENT_STATUSES = ['scheduled', 'confirmed', 'swapped', 'dropped', 'cancelled'] as const;
export const CONFLICT_SEVERITIES = ['WARNING', 'BLOCKING'] as const;
export const OPTIMIZATION_STATUSES = ['pending', 'running', 'completed', 'failed', 'timeout'] as const;
export const OPTIMIZATION_PATHS = ['interactive', 'async'] as const;

// ---- Attendance ----
export const ATTENDANCE_STATUSES = [
  'present',
  'late',
  'absent',
  'on_leave',
  'holiday',
  'day_off',
  'missing_clock_in',
  'missing_clock_out',
  'early_departure',
  'overtime',
  'half_day',
] as const;

export const ATTENDANCE_EVENT_TYPES = [
  'clock_in',
  'clock_out',
  'break_start',
  'break_end',
  'correction',
  'manual_override',
] as const;

export const ATTENDANCE_EVENT_SOURCES = ['mobile', 'web', 'device', 'offline_sync'] as const;

// ---- Leave types ----
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

// ---- Notification channels ----
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push'] as const;

// ---- Swap / open-shift statuses ----
export const SWAP_REQUEST_STATUSES = ['pending', 'accepted', 'rejected', 'cancelled', 'approved'] as const;
export const OPEN_SHIFT_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

// ---- Notification event types (in-app event bus) ----
export const NOTIFICATION_EVENT_TYPES = [
  'schedule.published',
  'shift.assigned',
  'open_shift.available',
  'open_shift.requested',
  'open_shift.approved',
  'open_shift.rejected',
  'swap.requested',
  'swap.accepted',
  'swap.rejected',
  'swap.approved',
  'leave.approved',
  'leave.rejected',
  'attendance.exception',
  'presence_verification.missed',
  'presence_verification.verified',
  'presence_verification.outside_geofence',
] as const;

// ---- Queue names ----
export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  REPORTS: 'reports',
  SCHEDULE_OPTIMIZATION: 'schedule-optimization',
  DOCUMENT_EXPIRY: 'document-expiry',
  BILLING_RETRY: 'billing-retry',
  AUDIT_RETENTION: 'audit-retention',
  OFFLINE_RECONCILIATION: 'offline-reconciliation',
} as const;

// ---- Pagination defaults ----
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

// ---- Date/time ----
export const DATE_FORMAT = 'YYYY-MM-DD';
export const DATETIME_FORMAT = "YYYY-MM-DD'T'HH:mm:ss'Z'";

// ---- HTTP status codes (semantic aliases) ----
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
} as const;
