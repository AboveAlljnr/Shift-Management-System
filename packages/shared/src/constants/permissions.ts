// ---- Canonical permission actions (mirrors apps/api/prisma/seed.ts catalog) ----
export const PERMISSION_ACTIONS = [
  // Employee
  'employee.read',
  'employee.create',
  'employee.update',
  'employee.deactivate',
  'employee.export',
  'employee.read_sensitive',
  // Scheduling
  'schedule.read',
  'schedule.create',
  'schedule.edit',
  'schedule.publish',
  'schedule.approve',
  'schedule.lock',
  'schedule.override_lock',
  'shift.assign',
  'shift.conflict_override',
  // Availability
  'availability.read',
  'availability.manage',
  // Attendance
  'attendance.read',
  'attendance.correct',
  'attendance.override',
  'attendance.export',
  // Leave
  'leave.read',
  'leave.request',
  'leave.approve',
  'leave.export',
  // Documents
  'document.read',
  'document.upload',
  'document.read_sensitive',
  'document.export',
  // Reports
  'report.view',
  'report.export',
  // Billing
  'billing.view',
  'billing.manage',
  // Company / settings
  'company.settings.manage',
  'company.members.invite',
  'company.members.manage',
  'role.manage',
  'permission.override',
  // Activity / leave admin
  'activity.manage',
  'leave_type.manage',
  'leave_balance.adjust',
  // Audit
  'audit.read',
] as const;

/**
 * Canonical effective-permission sets per system role (docs/03-auth/roles.md).
 * Keyed by role code as stored in the Role table — per-company system roles
 * are created by auth.register / seed. Note: the 'OWNER' code casing differs
 * from the lowercase constants in USER_ROLES; that mismatch is tracked as a
 * known discrepancy and intentionally not renamed in this phase.
 */
export const ROLE_PERMISSION_TEMPLATES: Record<string, readonly string[]> = {
  // Owner: unrestricted within the company.
  OWNER: [...PERMISSION_ACTIONS],

  // Admin: full company administration, excluding sensitive + financial writes.
  ADMIN: [
    'employee.read',
    'employee.create',
    'employee.update',
    'employee.deactivate',
    'employee.export',
    'schedule.read',
    'schedule.create',
    'schedule.edit',
    'schedule.publish',
    'schedule.approve',
    'schedule.lock',
    'shift.assign',
    'shift.conflict_override',
    'availability.read',
    'availability.manage',
    'attendance.read',
    'attendance.correct',
    'attendance.override',
    'attendance.export',
    'leave.read',
    'leave.approve',
    'leave.export',
    'document.read',
    'document.upload',
    'document.export',
    'report.view',
    'report.export',
    'billing.view',
    'company.settings.manage',
    'company.members.invite',
    'company.members.manage',
    'role.manage',
    'permission.override',
    'activity.manage',
    'leave_type.manage',
    'leave_balance.adjust',
    'audit.read',
  ],

  // Manager: full workforce management within their granted scope.
  MANAGER: [
    'employee.read',
    'employee.create',
    'employee.update',
    'employee.deactivate',
    'employee.export',
    'schedule.read',
    'schedule.create',
    'schedule.edit',
    'schedule.publish',
    'schedule.approve',
    'schedule.lock',
    'shift.assign',
    'shift.conflict_override',
    'availability.read',
    'availability.manage',
    'attendance.read',
    'attendance.correct',
    'attendance.export',
    'leave.read',
    'leave.approve',
    'report.view',
  ],

  // Shift Manager: operational scheduling within their granted scope.
  SHIFT_MANAGER: [
    'employee.read',
    'schedule.read',
    'shift.assign',
    'shift.conflict_override',
    'availability.read',
    'attendance.read',
  ],

  // Employee: self-service only.
  EMPLOYEE: [
    'employee.read',
    'schedule.read',
    'availability.read',
    'availability.manage',
    'attendance.read',
    'leave.read',
    'leave.request',
  ],
};

export function getRolePermissionTemplate(roleCode: string): readonly string[] {
  return ROLE_PERMISSION_TEMPLATES[roleCode] ?? [];
}