import { PrismaClient } from '@prisma/client';

import { ROLE_PERMISSION_TEMPLATES } from '@sms/shared';

const prisma = new PrismaClient();

/**
 * Canonical permission catalog (docs/03-auth/permissions.md).
 * Format: { action: 'resource.action', resource, description }
 */
const PERMISSIONS: { action: string; resource: string; description: string }[] = [
  // Employee
  { action: 'employee.read', resource: 'employee', description: 'View employee records' },
  { action: 'employee.create', resource: 'employee', description: 'Create employees' },
  { action: 'employee.update', resource: 'employee', description: 'Update employee records' },
  { action: 'employee.deactivate', resource: 'employee', description: 'Deactivate employees' },
  { action: 'employee.export', resource: 'employee', description: 'Export employee data' },
  { action: 'employee.read_sensitive', resource: 'employee', description: 'View sensitive employee data' },
  // Scheduling
  { action: 'schedule.read', resource: 'schedule', description: 'View schedules' },
  { action: 'schedule.create', resource: 'schedule', description: 'Create schedules' },
  { action: 'schedule.edit', resource: 'schedule', description: 'Edit schedules' },
  { action: 'schedule.publish', resource: 'schedule', description: 'Publish schedules' },
  { action: 'schedule.approve', resource: 'schedule', description: 'Approve schedules' },
  { action: 'schedule.lock', resource: 'schedule', description: 'Lock schedules' },
  { action: 'schedule.override_lock', resource: 'schedule', description: 'Override locked schedules' },
  { action: 'shift.assign', resource: 'schedule', description: 'Assign employees to shifts' },
  { action: 'shift.conflict_override', resource: 'schedule', description: 'Override scheduling conflicts' },
  // Attendance
  { action: 'attendance.read', resource: 'attendance', description: 'View attendance records' },
  { action: 'attendance.correct', resource: 'attendance', description: 'Correct attendance records' },
  { action: 'attendance.override', resource: 'attendance', description: 'Override attendance records' },
  { action: 'attendance.export', resource: 'attendance', description: 'Export attendance data' },
  // Leave
  { action: 'leave.read', resource: 'leave', description: 'View leave records' },
  { action: 'leave.request', resource: 'leave', description: 'Request leave (self)' },
  { action: 'leave.approve', resource: 'leave', description: 'Approve/reject leave requests' },
  { action: 'leave.export', resource: 'leave', description: 'Export leave data' },
  // Documents
  { action: 'document.read', resource: 'document', description: 'View documents' },
  { action: 'document.upload', resource: 'document', description: 'Upload documents' },
  { action: 'document.read_sensitive', resource: 'document', description: 'View sensitive documents' },
  { action: 'document.export', resource: 'document', description: 'Export documents' },
  // Reports
  { action: 'report.view', resource: 'report', description: 'View reports' },
  { action: 'report.export', resource: 'report', description: 'Export reports' },
  // Billing
  { action: 'billing.view', resource: 'billing', description: 'View billing information' },
  { action: 'billing.manage', resource: 'billing', description: 'Manage billing' },
  // Company / Settings
  { action: 'company.settings.manage', resource: 'company', description: 'Manage company settings' },
  { action: 'company.members.invite', resource: 'company', description: 'Invite company members' },
  { action: 'company.members.manage', resource: 'company', description: 'Manage company members' },
  { action: 'role.manage', resource: 'company', description: 'Manage roles' },
  { action: 'permission.override', resource: 'company', description: 'Override member permissions' },
  // Activities / Leave management
  { action: 'activity.manage', resource: 'activity', description: 'Manage activities' },
  { action: 'leave_type.manage', resource: 'leave', description: 'Manage leave types' },
  { action: 'leave_balance.adjust', resource: 'leave', description: 'Adjust leave balances' },
  // Audit
  { action: 'audit.read', resource: 'audit', description: 'View audit logs' },
];

async function main() {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { action: p.action },
      update: { resource: p.resource, description: p.description },
      create: p,
    });
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions.`);

  // Self-heal: grant canonical Owner permissions to every per-company system
  // Owner role (including companies created before permission wiring existed).
  // Idempotent: connectOrCreate per role/permission pair.
  const canonicalOwnerActions = ROLE_PERMISSION_TEMPLATES['OWNER'] ?? [];
  const ownerRoles = await prisma.role.findMany({
    where: { code: 'OWNER', isSystemRole: true },
    select: { id: true },
  });
  const catalog = await prisma.permission.findMany({
    where: { action: { in: [...canonicalOwnerActions] } },
    select: { id: true, action: true },
  });

  let linked = 0;
  for (const role of ownerRoles) {
    for (const permission of catalog) {
      const existing = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      });
      if (!existing) {
        await prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: permission.id },
        });
        linked += 1;
      }
    }
  }

  console.log(
    `Linked ${linked} Owner role-permission grants across ${ownerRoles.length} Owner role(s); catalog covers ${catalog.length} of ${canonicalOwnerActions.length} canonical Owner actions.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
