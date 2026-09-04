import { PrismaClient } from '@prisma/client';

import {
  getRolePermissionTemplate,
  ROLE_PERMISSION_TEMPLATES,
} from '@sms/shared';
import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

interface DemoAccount {
  email: string;
  password: string;
  name: string;
  roleCode: string;
  employeeNumber: string;
}

const DEMO_COMPANY = {
  name: 'Demo Company',
  slug: 'demo',
  timezone: 'UTC',
};

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    email: 'owner@demo.com',
    password: 'DemoPass-123!',
    name: 'Demo Owner',
    roleCode: 'OWNER',
    employeeNumber: 'DEMO-001',
  },
  {
    email: 'manager@demo.com',
    password: 'DemoPass-123!',
    name: 'Demo Manager',
    roleCode: 'MANAGER',
    employeeNumber: 'DEMO-002',
  },
  {
    email: 'employee@demo.com',
    password: 'DemoPass-123!',
    name: 'Demo Employee',
    roleCode: 'EMPLOYEE',
    employeeNumber: 'DEMO-003',
  },
  {
    email: 'supervisor@demo.com',
    password: 'DemoPass-123!',
    name: 'Demo Supervisor',
    roleCode: 'SHIFT_MANAGER',
    employeeNumber: 'DEMO-004',
  },
];

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
  // Availability
  { action: 'availability.read', resource: 'availability', description: 'View availability' },
  { action: 'availability.manage', resource: 'availability', description: 'Manage availability rules and exceptions' },
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

  await seedDemoCompany();
}

/**
 * Creates a demo company with stable Owner, Manager, and Employee accounts so
 * the app can be explored without registering a new company. Idempotent: skips
 * any record that already exists and logs what was created.
 */
async function seedDemoCompany(): Promise<void> {
  const created: string[] = [];

  const company = await prisma.company.upsert({
    where: { slug: DEMO_COMPANY.slug },
    update: {},
    create: {
      name: DEMO_COMPANY.name,
      slug: DEMO_COMPANY.slug,
      timezone: DEMO_COMPANY.timezone,
    },
  });

  created.push(`company:${company.slug}`);

  const defaultBranch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: 'MAIN' } },
    update: {},
    create: {
      companyId: company.id,
      name: 'Main Branch',
      code: 'MAIN',
      timezone: DEMO_COMPANY.timezone,
    },
  });

  const fullTimeType = await prisma.employmentType.upsert({
    where: { companyId_code: { companyId: company.id, code: 'FT' } },
    update: {},
    create: {
      companyId: company.id,
      name: 'Full Time',
      code: 'FT',
    },
  });

  for (const account of DEMO_ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {},
      create: {
        email: account.email,
        passwordHash: await bcrypt.hash(account.password, SALT_ROUNDS),
        name: account.name,
        status: 'active',
        emailVerifiedAt: new Date(),
      },
    });

    const membership = await prisma.companyMembership.upsert({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      update: {},
      create: {
        userId: user.id,
        companyId: company.id,
        status: 'active',
        joinedAt: new Date(),
      },
    });

    const role =
      (await prisma.role.findFirst({
        where: { companyId: company.id, code: account.roleCode },
      })) ??
      (await prisma.role.create({
        data: {
          companyId: company.id,
          name:
            account.roleCode.charAt(0) + account.roleCode.slice(1).toLowerCase(),
          code: account.roleCode,
          isSystemRole: true,
        },
      }));

    const actions = getRolePermissionTemplate(account.roleCode);
    if (actions.length > 0) {
      const perms = await prisma.permission.findMany({
        where: { action: { in: [...actions] } },
        select: { id: true },
      });
      if (perms.length > 0) {
        await prisma.rolePermission.createMany({
          data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
          skipDuplicates: true,
        });
      }
    }

    await prisma.userRole.upsert({
      where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
      update: {},
      create: { membershipId: membership.id, roleId: role.id },
    });

    if (!(await prisma.accessScope.findFirst({ where: { membershipId: membership.id } }))) {
      await prisma.accessScope.create({
        data: {
          membershipId: membership.id,
          scopeType: 'company',
          scopeId: company.id,
        },
      });
    }

    const employeeExists = await prisma.employee.findFirst({
      where: { companyId: company.id, userId: user.id },
    });
    if (!employeeExists) {
      await prisma.employee.create({
        data: {
          companyId: company.id,
          userId: user.id,
          employeeNumber: account.employeeNumber,
          firstName: account.name.split(' ')[0] || account.name,
          lastName:
            account.name.split(' ').slice(1).join(' ') || account.roleCode,
          email: account.email,
          employmentTypeId: fullTimeType.id,
          branchId: defaultBranch.id,
          hireDate: new Date(),
          status: 'active',
        },
      });
      created.push(`user:${account.email}`);
    }
  }

  await seedDemoQualifications(company, created);

  const leaveTypes = [
    { code: 'ANNUAL', name: 'Annual Leave', defaultEntitlementDays: 21 },
    { code: 'SICK', name: 'Sick Leave', defaultEntitlementDays: 14 },
    { code: 'CARRYOVER', name: 'Carryover Leave', defaultEntitlementDays: 5 },
  ];
  for (const lt of leaveTypes) {
    const existing = await prisma.leaveType.findFirst({
      where: { companyId: company.id, code: lt.code },
    });
    if (!existing) {
      await prisma.leaveType.create({
        data: {
          companyId: company.id,
          code: lt.code,
          name: lt.name,
          defaultEntitlementDays: lt.defaultEntitlementDays,
          isActive: true,
        },
      });
      created.push(`leaveType:${lt.code}`);
    }
  }

  console.log(`Demo company '${DEMO_COMPANY.slug}' ready. Accounts: ${DEMO_ACCOUNTS.map((a) => `${a.email} / ${a.password}`).join(', ')}`);
  if (created.length > 0) {
    console.log(`Created (new): ${created.join(', ')}`);
  }
}

/**
 * Seeds a small qualification catalog (skills + certifications) and grants them
 * to the demo Employee and Supervisor so the qualification-aware scheduling
 * features can be exercised out of the box. Idempotent upserts / skipDuplicates.
 */
interface CompanyRow {
  id: string;
  slug: string;
}

async function seedDemoQualifications(company: CompanyRow, created: string[]): Promise<void> {
  const skills = [
    { code: 'BARISTA', name: 'Barista — Specialty Coffee' },
    { code: 'CASH', name: 'Cash Handling' },
  ];
  const certifications = [
    { code: 'FOOD', name: 'Food Handling', validityPeriodDays: 365 },
    { code: 'FIRSTAID', name: 'First Aid', validityPeriodDays: 730 },
  ];

  const skillIds = new Map<string, string>();
  const certificationIds = new Map<string, string>();

  for (const s of skills) {
    const row = await prisma.skill.upsert({
      where: { companyId_code: { companyId: company.id, code: s.code } },
      update: {},
      create: { companyId: company.id, name: s.name, code: s.code },
    });
    skillIds.set(s.code, row.id);
    created.push(`skill:${s.code}`);
  }

  for (const c of certifications) {
    const row = await prisma.certification.upsert({
      where: { companyId_code: { companyId: company.id, code: c.code } },
      update: {},
      create: {
        companyId: company.id,
        name: c.name,
        code: c.code,
        validityPeriodDays: c.validityPeriodDays,
      },
    });
    certificationIds.set(c.code, row.id);
    created.push(`certification:${c.code}`);
  }

  const now = new Date();
  const granteeEmails = ['employee@demo.com', 'supervisor@demo.com'];
  for (const email of granteeEmails) {
    const member = await prisma.employee.findFirst({
      where: { companyId: company.id, email },
      select: { id: true },
    });
    if (!member) continue;

    await prisma.employeeSkill.createMany({
      data: [skillIds.get('BARISTA')!, skillIds.get('CASH')!].map((skillId) => ({
        employeeId: member.id,
        skillId,
        proficiencyLevel: 'advanced',
      })),
      skipDuplicates: true,
    });

    await prisma.employeeCertification.createMany({
      data: [certificationIds.get('FOOD')!, certificationIds.get('FIRSTAID')!].map(
        (certificationId) => ({
          employeeId: member.id,
          certificationId,
          issuedAt: now,
          expiresAt: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()),
          issuer: 'Seeded catalog',
        }),
      ),
      skipDuplicates: true,
    });

    created.push(`qualifications:${email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
