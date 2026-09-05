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

/** Employee records that are fully owned by the demo seed (safe to re-seed). */
const DEMO_WORKER_NUMBERS = ['DEMO-005', 'DEMO-006', 'DEMO-007', 'DEMO-008'];

const DEMO_ACCOUNT_EMAILS = DEMO_ACCOUNTS.map((a) => a.email);

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
 * Demo helper: date `offset` calendar days from today (UTC).
 * The demo dataset is anchored to relative dates so it stays "live" no matter
 * when the reset/seed runs.
 */
function dayOffset(offset: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

/** Date at a specific UTC hour. */
function atUtc(date: Date, hour: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, 0, 0));
}

/** Date `days` calendar-days from `date` (UTC). */
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Creates a demo company with stable Owner, Manager, and Employee accounts so
 * the app can be explored without registering a new company. Idempotent: skips
 * any record that already exists and logs what was created. Re-seeding refreshes
 * the demo operational data (shifts, availability, leave, notifications) so a
 * presenter always gets the same known-good scenario.
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

  await seedDemoQualifications(company);

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

  await seedDemoOperations(company, defaultBranch, fullTimeType, created);

  console.log(`Demo company '${DEMO_COMPANY.slug}' ready. Accounts: ${DEMO_ACCOUNTS.map((a) => `${a.email} / ${a.password}`).join(', ')}`);
  if (created.length > 0) {
    console.log(`Created (new): ${created.join(', ')}`);
  }
}

/**
 * A deterministic qualification catalog (skills + certifications). Grants are
 * applied in seedDemoOperations so the state can be refreshed on re-seed.
 */
async function seedDemoQualifications(company: { id: string; slug: string }): Promise<void> {
  const skills = [
    { code: 'BARISTA', name: 'Barista — Specialty Coffee' },
    { code: 'CASH', name: 'Cash Handling' },
  ];
  const certifications = [
    { code: 'FOOD', name: 'Food Handling', validityPeriodDays: 365 },
    { code: 'FIRSTAID', name: 'First Aid', validityPeriodDays: 730 },
  ];

  for (const s of skills) {
    await prisma.skill.upsert({
      where: { companyId_code: { companyId: company.id, code: s.code } },
      update: {},
      create: { companyId: company.id, name: s.name, code: s.code },
    });
  }

  for (const c of certifications) {
    await prisma.certification.upsert({
      where: { companyId_code: { companyId: company.id, code: c.code } },
      update: {},
      create: {
        companyId: company.id,
        name: c.name,
        code: c.code,
        validityPeriodDays: c.validityPeriodDays,
      },
    });
  }
}

interface DemoOperationsCtx {
  company: { id: string };
  branch: { id: string };
  employmentType: { id: string };
  created: string[];
  catalog: {
    skills: Map<string, string>;
    certs: Map<string, string>;
  };
  departmentId: string;
  teamId: string;
  /** employeeId by email for every demo-owned employee record. */
  byEmail: Map<string, string>;
  byNumber: Map<string, string>;
  leaveTypeId: (code: string) => Promise<string>;
}

/**
 * Seeds the deterministic demo operational scenario:
 *  - company settings (Presence Verification ON for the demo tenant, geofence STRICT)
 *  - org hierarchy (department + team)
 *  - active geofence on the demo branch
 *  - 4 more meaningful employees (qualified / on leave / missing skill / expired cert)
 *  - availability, leave balances, one approved leave (the optimizer blocker)
 *  - shifts incl. the "Evening Operations" AI story, an open shift, and an
 *    assigned shift today so the clock-in/geofence/presence demo can run live
 *  - a Schedule record so publishing works from the UI
 *  - a small notification set + one Presence Verification exception for the
 *    supervisor view
 *
 * Demo-owned rows (availability rules, demo leave requests, demo shift data,
 * demo notifications, demo attendance markers) are re-synced on every run so the
 * scenario stays deterministic.
 */
async function seedDemoOperations(
  company: { id: string },
  branch: { id: string },
  employmentType: { id: string },
  created: string[],
): Promise<void> {
  const today = dayOffset(0);

  // ---- Tenant demo configuration (demo tenant only; code defaults untouched) ----
  await prisma.company.update({
    where: { id: company.id },
    data: {
      settings: {
        presenceVerification: { enabled: true, verifyAfterMinutes: 1, graceMinutes: 15 },
        geofence: { mode: 'strict', allowMissingLocation: false },
      },
    },
  });
  created.push('settings:presence+geofence(demo tenant)');

  // ---- Hierarchy ----
  const foh = await prisma.department.upsert({
    where: { companyId_code: { companyId: company.id, code: 'FOH' } },
    update: {},
    create: { companyId: company.id, branchId: branch.id, name: 'Front of House', code: 'FOH' },
  });
  created.push('department:FOH');
  const bar = await prisma.team.upsert({
    where: { companyId_code: { companyId: company.id, code: 'BAR' } },
    update: {},
    create: { companyId: company.id, departmentId: foh.id, name: 'Bar Team', code: 'BAR' },
  });
  created.push('team:BAR');

  // ---- Active geofence for the demo branch (used by the live clock-in demo) ----
  if (!(await prisma.geofence.findFirst({ where: { companyId: company.id, branchId: branch.id, isActive: true } }))) {
    await prisma.geofence.create({
      data: {
        companyId: company.id,
        branchId: branch.id,
        name: 'Main Branch Geofence',
        latitude: 40.712775,
        longitude: -74.005973,
        radiusMeters: 500,
        isActive: true,
      },
    });
    created.push('geofence:MAIN');
  }

  const byEmail = new Map<string, string>();
  const byNumber = new Map<string, string>();
  for (const e of await prisma.employee.findMany({
    where: { companyId: company.id },
    select: { id: true, email: true, employeeNumber: true },
  })) {
    byEmail.set(e.email, e.id);
    byNumber.set(e.employeeNumber, e.id);
  }

  const managerId = byEmail.get('manager@demo.com');
  const ownerId = byEmail.get('owner@demo.com');
  if (managerId) {
    await prisma.department.update({ where: { id: foh.id }, data: { managerId } });
    await prisma.team.update({ where: { id: bar.id }, data: { managerId } });
  }
  const managerEmp = managerId ? { id: managerId } : null;
  const managerUserId = (
    await prisma.user.findFirst({ where: { email: 'manager@demo.com' }, select: { id: true } })
  )?.id;

  const ctx: DemoOperationsCtx = {
    company,
    branch,
    employmentType,
    created,
    catalog: {
      skills: await readCatalogIds(company.id, 'skill'),
      certs: await readCatalogIds(company.id, 'certification'),
    },
    departmentId: foh.id,
    teamId: bar.id,
    byEmail,
    byNumber,
    leaveTypeId: (code: string) => bareLeaveTypeId(company.id, code),
  };

  // ---- Demo workers (no login accounts) ----
  const workers = [
    {
      number: 'DEMO-005',
      firstName: 'Sam',
      lastName: 'Carter',
      email: 'sam.carter@demo.com',
      hireDate: '2023-01-15',
      skills: ['BARISTA', 'CASH'],
      certs: [['FOOD', 365] as const, ['FIRSTAID', 730] as const],
    },
    {
      number: 'DEMO-006',
      firstName: 'Priya',
      lastName: 'Nair',
      email: 'priya.nair@demo.com',
      hireDate: '2023-03-20',
      skills: ['CASH'],
      certs: [['FOOD', 365] as const],
    },
    {
      number: 'DEMO-007',
      firstName: 'Miguel',
      lastName: 'Rojas',
      email: 'miguel.rojas@demo.com',
      hireDate: '2023-06-10',
      skills: ['BARISTA', 'CASH'],
      certs: [['FOOD', 365] as const, ['FIRSTAID', -2] as const],
    },
    {
      number: 'DEMO-008',
      firstName: 'Aisha',
      lastName: 'Khan',
      email: 'aisha.khan@demo.com',
      hireDate: '2024-02-01',
      skills: ['BARISTA', 'CASH'],
      certs: [['FOOD', 365] as const, ['FIRSTAID', 730] as const],
    },
  ];
  for (const w of workers) {
    const existing = await prisma.employee.findFirst({
      where: { companyId: company.id, employeeNumber: w.number },
    });
    const employee =
      existing ??
      (await prisma.employee.create({
        data: {
          companyId: company.id,
          employeeNumber: w.number,
          firstName: w.firstName,
          lastName: w.lastName,
          email: w.email,
          employmentTypeId: employmentType.id,
          branchId: branch.id,
          departmentId: foh.id,
          teamId: bar.id,
          hireDate: new Date(w.hireDate),
          status: 'active',
        },
      }));
    byEmail.set(w.email, employee.id);
    byNumber.set(w.number, employee.id);
    if (!existing) created.push(`employee:${w.number} ${w.firstName} ${w.lastName}`);
  }

  // Assign demo accounts to the hierarchy
  await prisma.employee.updateMany({
    where: {
      companyId: company.id,
      id: {
        in: [
          byEmail.get('employee@demo.com'),
          byEmail.get('supervisor@demo.com'),
          byEmail.get('manager@demo.com'),
          ...DEMO_WORKER_NUMBERS.map((n) => byNumber.get(n)),
        ].filter((id): id is string => !!id),
      },
    },
    data: { departmentId: foh.id },
  });
  await prisma.employee.updateMany({
    where: {
      companyId: company.id,
      id: {
        in: [
          byEmail.get('employee@demo.com'),
          byEmail.get('supervisor@demo.com'),
          ...DEMO_WORKER_NUMBERS.map((n) => byNumber.get(n)),
        ].filter((id): id is string => !!id),
      },
    },
    data: { teamId: bar.id },
  });

  // ---- Qualifications: refresh demo-owned grants (this is the "workforce" story) ----
  const demoQualIds = [
    byEmail.get('employee@demo.com'),
    byEmail.get('supervisor@demo.com'),
    ...DEMO_WORKER_NUMBERS.map((n) => byNumber.get(n)),
  ].filter((id): id is string => !!id);
  await prisma.employeeSkill.deleteMany({ where: { employeeId: { in: demoQualIds } } });
  await prisma.employeeCertification.deleteMany({ where: { employeeId: { in: demoQualIds } } });

  await grantQualifications(ctx, 'employee@demo.com', ['BARISTA', 'CASH'], [['FOOD', 365], ['FIRSTAID', 730]]);
  await grantQualifications(ctx, 'supervisor@demo.com', ['CASH'], [['FOOD', 365]]);
  for (const w of workers) {
    await grantQualifications(ctx, w.email, w.skills, w.certs as Array<[string, number]>);
  }

  // ---- Leave types + balances + requests ----
  const annualId = await ctx.leaveTypeId('ANNUAL');
  const sickId = await ctx.leaveTypeId('SICK');
  if (!annualId || !sickId) {
    throw new Error('Demo leave types not seeded');
  }

  const leaveEmployeeIds = [...demoQualIds];
  await prisma.leaveBalance.deleteMany({ where: { employeeId: { in: leaveEmployeeIds } } });
  await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: leaveEmployeeIds } } });

  const balances: Array<{ id: string; annualUsed: number; sickUsed: number }> = [
    { id: byNumber.get('DEMO-003')!, annualUsed: 2, sickUsed: 0 },
    { id: byNumber.get('DEMO-005')!, annualUsed: 7, sickUsed: 1 },
    { id: byNumber.get('DEMO-006')!, annualUsed: 0, sickUsed: 0 },
    { id: byNumber.get('DEMO-007')!, annualUsed: 1, sickUsed: 0 },
    { id: byNumber.get('DEMO-008')!, annualUsed: 0, sickUsed: 0 },
  ];
  for (const b of balances) {
    await prisma.leaveBalance.createMany({
      data: [
        { companyId: company.id, employeeId: b.id, leaveTypeId: annualId, year: today.getUTCFullYear(), entitlementDays: 21, usedDays: b.annualUsed, pendingDays: 0, remainingDays: 21 - b.annualUsed },
        { companyId: company.id, employeeId: b.id, leaveTypeId: sickId, year: today.getUTCFullYear(), entitlementDays: 14, usedDays: b.sickUsed, pendingDays: 0, remainingDays: 14 - b.sickUsed },
      ],
    });
  }
  created.push(`leaveBalances:${balances.length} employees`);

  // Sam: APPROVED leave on the Evening Operations day (the optimizer's leave blocker)
  await prisma.leaveRequest.create({
    data: {
      companyId: company.id,
      employeeId: byNumber.get('DEMO-005')!,
      leaveTypeId: annualId,
      startDate: dayOffset(7),
      endDate: dayOffset(7),
      requestedDays: 1,
      status: 'approved',
      reason: 'Family event (seeded demo blocker)',
      reviewedById: managerUserId,
      reviewedAt: addDays(today, -1),
      reviewNote: 'Approved by Demo Manager',
    },
  });
  // Priya: PENDING leave next week so the Leave workflow has a live item
  await prisma.leaveRequest.create({
    data: {
      companyId: company.id,
      employeeId: byNumber.get('DEMO-006')!,
      leaveTypeId: annualId,
      startDate: dayOffset(14),
      endDate: dayOffset(16),
      requestedDays: 3,
      status: 'pending',
      reason: 'Family ceremony',
    },
  });
  created.push('leaveRequests:Sam approved + Priya pending');

  // ---- Availability (all demo staff: 06:00-23:00 every day) ----
  await prisma.availabilityRule.deleteMany({ where: { employeeId: { in: demoQualIds } } });
  const ruleRows = [];
  for (const id of demoQualIds) {
    for (let dow = 0; dow < 7; dow += 1) {
      ruleRows.push({
        employeeId: id,
        companyId: company.id,
        dayOfWeek: dow,
        startTime: '06:00',
        endTime: '23:00',
        isAvailable: true,
        effectiveFrom: addDays(today, -1),
      });
    }
  }
  await prisma.availabilityRule.createMany({ data: ruleRows });
  created.push(`availabilityRules:${ruleRows.length} rows`);

  // ---- Shifts + Schedule ----
  const schedule = await upsertDemoSchedule(company.id, branch.id, managerEmp?.id);
  created.push(`schedule:${schedule.name}`);

  const evening = await upsertDemoShift(
    company.id,
    branch.id,
    ctx,
    { name: 'Evening Operations', day: 7, startHour: 16, endHour: 20, isOpen: false },
    schedule.id,
  );
  const midday = await upsertDemoShift(
    company.id,
    branch.id,
    ctx,
    { name: 'Midday Cover', day: 7, startHour: 10, endHour: 14, isOpen: false },
    schedule.id,
  );
  await upsertDemoShift(
    company.id,
    branch.id,
    ctx,
    { name: 'Morning Shift', day: 0, startHour: 8, endHour: 12, isOpen: false },
    schedule.id,
  );
  await upsertDemoShift(
    company.id,
    branch.id,
    ctx,
    { name: 'Weekend Service', day: -2, startHour: 10, endHour: 14, isOpen: false },
    schedule.id,
  );
  await upsertDemoShift(
    company.id,
    branch.id,
    ctx,
    { name: 'Late Bar', day: -1, startHour: 16, endHour: 20, isOpen: false },
    schedule.id,
  );
  await upsertDemoShift(
    company.id,
    branch.id,
    ctx,
    { name: 'Open Shift — Cover Needed', day: 8, startHour: 10, endHour: 14, isOpen: true },
    schedule.id,
  );

  // Assignments that make the schedule + mobile views alive
  await prisma.shiftAssignment.deleteMany({
    where: { shiftId: { in: await demoShiftIds(company.id) } },
  });
  await assignToShift(company.id, 'Morning Shift', [byEmail.get('employee@demo.com')!]);
  await assignToShift(company.id, 'Weekend Service', [byEmail.get('priya.nair@demo.com')!]);
  await assignToShift(company.id, 'Late Bar', [
    byEmail.get('employee@demo.com')!,
    byEmail.get('aisha.khan@demo.com')!,
  ]);

  // The AI story shift: REQUIRED 2 x BARISTA + FIRSTAID, intentionally unassigned.
  await setShiftRequirements(company.id, evening.id, [
    { headcount: 2, skills: ['BARISTA'], certifications: ['FIRSTAID'] },
  ]);
  // Midday cover needs a cashier, keeping the demo optimizer story honest:
  // employees without the CASH skill (owner, manager) are truthfully excluded.
  await setShiftRequirements(company.id, midday.id, [
    { headcount: 1, skills: ['CASH'], certifications: [] },
  ]);

  // ---- Notifications (small, readable set; unread is deliberately light) ----
  await prisma.notification.deleteMany({
    where: { companyId: company.id, recipient: { email: { in: DEMO_ACCOUNT_EMAILS } } },
  });
  const demoUsers = await prisma.user.findMany({
    where: { email: { in: DEMO_ACCOUNT_EMAILS } },
    select: { id: true, email: true },
  });
  const userByEmail = new Map(demoUsers.map((u) => [u.email, u.id]));

  const notifRows: Array<{
    recipientUserId: string;
    eventType: string;
    title: string;
    body: string;
    isRead: boolean;
    ageHours: number;
    relatedEntityType?: string;
  }> = [];
  const pushNotif = (recipientEmail: string, n: Omit<(typeof notifRows)[number], 'recipientUserId'>) => {
    const recipientUserId = userByEmail.get(recipientEmail);
    if (!recipientUserId || !n.eventType || !n.title) return;
    notifRows.push({ ...n, recipientUserId });
  };
  pushNotif('employee@demo.com', {
    eventType: 'schedule.published',
    title: 'Schedule published',
    body: 'Week of Evening Operations has been published for Main Branch.',
    isRead: true,
    ageHours: 26,
  });
  pushNotif('employee@demo.com', {
    eventType: 'open_shift.available',
    title: 'Open shift available',
    body: 'Open Shift — Cover Needed (Main Branch) is open for pickup.',
    isRead: false,
    ageHours: 2,
    relatedEntityType: 'shift',
  });
  pushNotif('manager@demo.com', {
    eventType: 'schedule.published',
    title: 'Schedule published',
    body: 'Previous demo week schedule was published for Main Branch.',
    isRead: true,
    ageHours: 30,
  });
  pushNotif('supervisor@demo.com', {
    eventType: 'open_shift.available',
    title: 'Open shift available',
    body: 'Open Shift — Cover Needed (Main Branch) is open for review.',
    isRead: true,
    ageHours: 3,
    relatedEntityType: 'shift',
  });
  for (const n of notifRows) {
    await prisma.notification.create({
      data: {
        companyId: company.id,
        recipientId: n.recipientUserId,
        channel: 'in_app',
        eventType: n.eventType,
        title: n.title,
        body: n.body,
        isRead: n.isRead,
        readAt: n.isRead ? addDays(today, -1) : null,
        relatedEntityType: n.relatedEntityType,
        deliveredAt: addDays(today, -1),
        deliveryStatus: 'delivered',
        createdAt: new Date(Date.now() - n.ageHours * 3_600_000),
      },
    });
  }
  created.push(`notifications:${notifRows.length} rows (unread badge = ${notifRows.filter((n) => !n.isRead && n.recipientUserId === userByEmail.get('employee@demo.com')).length} for DEMO-003)`);

  // ---- Presence Verification exception for the supervisor view (real event, missed check) ----
  await seedPresenceException(ctx, 'priya.nair@demo.com', dayOffset(-1), addDays(today, -1), '00000000-0000-4000-8000-00000000d0c1');
  await seedPresenceException(ctx, 'priya.nair@demo.com', today, today, '00000000-0000-4000-8000-00000000d0c2');
  created.push('presence:2 MISSED exceptions (Priya)');
}

async function readCatalogIds(
  companyId: string,
  kind: 'skill' | 'certification',
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (kind === 'skill') {
    for (const r of await prisma.skill.findMany({ where: { companyId } })) map.set(r.code, r.id);
  } else {
    for (const r of await prisma.certification.findMany({ where: { companyId } })) map.set(r.code, r.id);
  }
  return map;
}

async function bareLeaveTypeId(companyId: string, code: string): Promise<string> {
  const lt = await prisma.leaveType.findFirst({ where: { companyId, code } });
  return lt?.id ?? '';
}

async function grantQualifications(
  ctx: DemoOperationsCtx,
  email: string,
  skillCodes: string[],
  certs: Array<[string, number]>,
): Promise<void> {
  const employeeId = ctx.byEmail.get(email);
  if (!employeeId) return;
  const now = new Date();

  await prisma.employeeSkill.createMany({
    data: skillCodes
      .map((code) => ctx.catalog.skills.get(code))
      .filter((id): id is string => !!id)
      .map((skillId) => ({ employeeId, skillId, proficiencyLevel: 'expert' })),
    skipDuplicates: true,
  });

  await prisma.employeeCertification.createMany({
    data: certs
      .map(([code, validDays]) => {
        const certificationId = ctx.catalog.certs.get(code);
        if (!certificationId) return null;
        return {
          employeeId,
          certificationId,
          issuedAt: addDays(now, validDays - 365 * 4),
          expiresAt: addDays(now, validDays),
          issuer: 'Seeded catalog',
        };
      })
      .filter((r): r is NonNullable<typeof r> => !!r),
    skipDuplicates: true,
  });
  ctx.created.push(`qualifications:${email}`);
}

async function upsertDemoSchedule(
  companyId: string,
  branchId: string,
  managerEmpId: string | undefined,
) {
  const name = 'Main Branch — Demo Week';
  const existing = await prisma.schedule.findFirst({ where: { companyId, name } });
  const data = {
    periodStart: dayOffset(-2),
    periodEnd: dayOffset(9),
  };
  const managerUser = managerEmpId
    ? await prisma.employee.findUnique({ where: { id: managerEmpId }, select: { userId: true } })
    : null;
  const ownerUser = await prisma.user.findFirst({ where: { email: 'manager@demo.com' }, select: { id: true } });
  const createdById = managerUser?.userId ?? ownerUser?.id;
  if (!createdById) throw new Error('Demo manager user not found; cannot create schedule');

  if (existing) {
    return prisma.schedule.update({
      where: { id: existing.id },
      data: { ...data, status: 'draft' },
    });
  }
  return prisma.schedule.create({
    data: { companyId, branchId, name, ...data, status: 'draft', createdById },
  });
}

interface DemoShiftSpec {
  name: string;
  day: number;
  startHour: number;
  endHour: number;
  isOpen: boolean;
}

async function upsertDemoShift(
  companyId: string,
  branchId: string,
  ctx: DemoOperationsCtx,
  spec: DemoShiftSpec,
  scheduleId: string,
) {
  const existing = await prisma.shift.findFirst({ where: { companyId, name: spec.name } });
  const data = {
    startAt: atUtc(dayOffset(spec.day), spec.startHour),
    endAt: atUtc(dayOffset(spec.day), spec.endHour),
    isOpen: spec.isOpen,
    status: 'draft' as const,
    departmentId: ctx.departmentId,
    teamId: ctx.teamId,
    scheduleId,
  };
  if (existing) {
    return prisma.shift.update({ where: { id: existing.id }, data });
  }
  return prisma.shift.create({
    data: { companyId, branchId, name: spec.name, ...data },
  });
}

async function demoShiftIds(companyId: string): Promise<string[]> {
  return (
    await prisma.shift.findMany({
      where: {
        companyId,
        name: {
          in: [
            'Evening Operations',
            'Midday Cover',
            'Morning Shift',
            'Weekend Service',
            'Late Bar',
            'Open Shift — Cover Needed',
          ],
        },
      },
      select: { id: true },
    })
  ).map((s) => s.id);
}

async function assignToShift(companyId: string, shiftName: string, employeeIds: string[]) {
  const shift = await prisma.shift.findFirst({ where: { companyId, name: shiftName } });
  if (!shift || employeeIds.length === 0) return;
  await prisma.shiftAssignment.createMany({
    data: employeeIds.map((employeeId) => ({ shiftId: shift.id, employeeId, status: 'scheduled' })),
    skipDuplicates: true,
  });
}

async function setShiftRequirements(
  companyId: string,
  shiftId: string,
  requirements: Array<{ headcount: number; skills: string[]; certifications: string[] }>,
) {
  await prisma.shiftRequirementSkill.deleteMany({ where: { requirement: { shiftId } } });
  await prisma.shiftRequirementCertification.deleteMany({ where: { requirement: { shiftId } } });
  await prisma.shiftRequirement.deleteMany({ where: { shiftId } });

  for (const req of requirements) {
    const row = await prisma.shiftRequirement.create({
      data: { shiftId, headcount: req.headcount },
    });
    const skillRows = [];
    for (const code of req.skills) {
      const skill = await prisma.skill.findFirst({ where: { companyId, code } });
      if (skill) skillRows.push({ requirementId: row.id, skillId: skill.id });
    }
    const certRows = [];
    for (const code of req.certifications) {
      const cert = await prisma.certification.findFirst({ where: { companyId, code } });
      if (cert) certRows.push({ requirementId: row.id, certificationId: cert.id });
    }
    if (skillRows.length > 0) {
      await prisma.shiftRequirementSkill.createMany({ data: skillRows, skipDuplicates: true });
    }
    if (certRows.length > 0) {
      await prisma.shiftRequirementCertification.createMany({ data: certRows, skipDuplicates: true });
    }
  }
}

async function seedPresenceException(
  ctx: DemoOperationsCtx,
  email: string,
  workDate: Date,
  clockInAt: Date,
  idempotencyKey: string,
) {
  const employeeId = ctx.byEmail.get(email);
  if (!employeeId) return;
  await prisma.attendanceRecord.deleteMany({ where: { employeeId, workDate } });

  const record = await prisma.attendanceRecord.create({
    data: {
      companyId: ctx.company.id,
      employeeId,
      workDate,
      status: 'present',
      effectiveClockIn: clockInAt,
      effectiveClockOut: null,
      totalWorkedMinutes: 0,
      totalBreakMinutes: 0,
    },
  });
  const event = await prisma.attendanceEvent.create({
    data: {
      attendanceRecordId: record.id,
      companyId: ctx.company.id,
      employeeId,
      eventType: 'clock_in',
      clientOccurredAt: clockInAt,
      source: 'mobile',
      deviceIdentifier: 'demo-seed',
      idempotencyKey,
      latitude: null,
      longitude: null,
      geofenceResult: JSON.stringify({ inside: true, distanceMeters: 0, radiusMeters: 500 }),
      metadata: { seededDemo: true },
    },
  });
  // MISSED: the employee never verified presence within dueAt + grace.
  // (demo Always-on presence verification would have made this MISSED after ~16 min.)
  await prisma.presenceVerification.create({
    data: {
      companyId: ctx.company.id,
      employeeId,
      branchId: ctx.branch.id,
      attendanceRecordId: record.id,
      attendanceEventId: event.id,
      dueAt: addDays(clockInAt, 0),
      verifiedAt: null,
      status: 'MISSED',
      latitude: null,
      longitude: null,
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });