import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export interface SeedUser {
  userId: string;
  email: string;
  password: string;
}

export interface SeedManager extends SeedUser {
  membershipId: string;
  employeeId: string;
}

export interface SeedEmployee extends SeedUser {
  membershipId: string;
  employeeId: string;
}

export class SeedHelper {
  constructor(private readonly prisma: PrismaClient) {}

  async hashPassword(pw: string): Promise<string> {
    return bcrypt.hash(pw, SALT_ROUNDS);
  }

  async createUser(email: string, name: string, pw: string): Promise<{ userId: string; email: string; password: string }> {
    const passwordHash = await this.hashPassword(pw);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, name, status: 'active' },
    });
    return { userId: user.id, email, password: pw };
  }

  async addManagerToCompany(
    companyId: string,
    opts?: { membershipId?: string; branchId?: string; suffix?: string },
  ): Promise<SeedManager> {
    const suffix = opts?.suffix ?? Date.now().toString(36);
    const email = `mgr-${suffix}@example.com`;
    const password = `Manager-${suffix}!`;
    const name = `Manager ${suffix}`;

    const { userId } = await this.createUser(email, name, password);

    const membership = await this.prisma.companyMembership.create({
      data: { userId, companyId, status: 'active', joinedAt: new Date() },
    });

    const role = await this.findOrCreateRole(companyId, 'Manager', 'MANAGER');
    await this.linkRolePermissions(role.id, 'MANAGER');

    await this.prisma.userRole.create({
      data: { membershipId: membership.id, roleId: role.id },
    });

    const branchId = opts?.branchId;
    if (branchId) {
      await this.prisma.accessScope.create({
        data: { membershipId: membership.id, scopeType: 'branch', scopeId: branchId },
      });
    } else {
      await this.prisma.accessScope.create({
        data: { membershipId: membership.id, scopeType: 'company', scopeId: companyId },
      });
    }

    const employmentType = await this.getDefaultEmploymentType(companyId);

    const employee = await this.prisma.employee.create({
      data: {
        companyId,
        userId,
        employeeNumber: `MGR-${suffix}`,
        firstName: name.split(' ')[0],
        lastName: suffix,
        email,
        employmentTypeId: employmentType.id,
        branchId,
        status: 'active',
        hireDate: new Date(),
      },
    });

    return { userId, email, password, membershipId: membership.id, employeeId: employee.id };
  }

  async addEmployeeToCompany(
    companyId: string,
    branchId: string,
    opts?: { departmentId?: string; teamId?: string; suffix?: string },
  ): Promise<SeedEmployee> {
    const suffix = opts?.suffix ?? Date.now().toString(36);
    const email = `emp-${suffix}@example.com`;
    const password = `Employee-${suffix}!`;
    const name = `Employee ${suffix}`;

    const { userId } = await this.createUser(email, name, password);

    const membership = await this.prisma.companyMembership.create({
      data: { userId, companyId, status: 'active', joinedAt: new Date() },
    });

    const role = await this.findOrCreateRole(companyId, 'Employee', 'EMPLOYEE');
    await this.linkRolePermissions(role.id, 'EMPLOYEE');

    await this.prisma.userRole.create({
      data: { membershipId: membership.id, roleId: role.id },
    });

    const employmentType = await this.getDefaultEmploymentType(companyId);

    const employee = await this.prisma.employee.create({
      data: {
        companyId,
        userId,
        employeeNumber: `EMP-${suffix}`,
        firstName: name.split(' ')[0],
        lastName: suffix,
        email,
        employmentTypeId: employmentType.id,
        branchId,
        departmentId: opts?.departmentId,
        teamId: opts?.teamId,
        status: 'active',
        hireDate: new Date(),
      },
    });

    await this.prisma.accessScope.create({
      data: { membershipId: membership.id, scopeType: 'self', scopeId: employee.id },
    });

    return { userId, email, password, membershipId: membership.id, employeeId: employee.id };
  }

  async addEmployeeUserToCompany(
    companyId: string,
    employeeId: string,
    opts?: { suffix?: string },
  ): Promise<SeedEmployee> {
    const employee = await this.prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const suffix = opts?.suffix ?? Date.now().toString(36);
    const email = `self-${suffix}@example.com`;
    const password = `Self-${suffix}!`;
    const name = `Self ${suffix}`;

    const { userId } = await this.createUser(email, name, password);

    await this.prisma.employee.update({
      where: { id: employeeId },
      data: { userId },
    });

    const membership = await this.prisma.companyMembership.create({
      data: { userId, companyId, status: 'active', joinedAt: new Date() },
    });

    const role = await this.findOrCreateRole(companyId, 'Employee', 'EMPLOYEE');
    await this.linkRolePermissions(role.id, 'EMPLOYEE');

    await this.prisma.userRole.create({
      data: { membershipId: membership.id, roleId: role.id },
    });

    await this.prisma.accessScope.create({
      data: { membershipId: membership.id, scopeType: 'self', scopeId: employeeId },
    });

    return { userId, email, password, membershipId: membership.id, employeeId };
  }

  async createLeaveType(companyId: string, code: string, name: string) {
    return this.prisma.leaveType.upsert({
      where: { companyId_code: { companyId, code } },
      update: {},
      create: {
        companyId,
        code,
        name,
        isPaid: true,
        defaultEntitlementDays: 20,
        carryOverLimit: 5,
      },
    });
  }

  async cleanupCompany(companyId: string) {
    const deletes: Promise<unknown>[] = [
      this.prisma.outboxEvent.deleteMany({ where: { companyId } }),
      this.prisma.auditLog.deleteMany({ where: { companyId } }),
      this.prisma.notification.deleteMany({ where: { companyId } }),
      this.prisma.shiftConflictOverride.deleteMany({ where: { companyId } }),
      this.prisma.shiftSwapRequest.deleteMany({ where: { companyId } }),
      this.prisma.openShiftRequest.deleteMany({ where: { companyId } }),
      this.prisma.optimizationRequest.deleteMany({ where: { companyId } }),
      this.prisma.attendanceCorrection.deleteMany({ where: { attendanceRecord: { companyId } } }),
      this.prisma.attendanceEvent.deleteMany({ where: { companyId } }),
      this.prisma.break.deleteMany({ where: { employee: { companyId } } }),
      this.prisma.attendanceRecord.deleteMany({ where: { companyId } }),
      this.prisma.leaveRequest.deleteMany({ where: { companyId } }),
      this.prisma.leaveBalance.deleteMany({ where: { companyId } }),
      this.prisma.leaveType.deleteMany({ where: { companyId } }),
      this.prisma.shiftAssignment.deleteMany({ where: { shift: { companyId } } }),
      this.prisma.shiftHistory.deleteMany({ where: { shift: { companyId } } }),
      this.prisma.shiftRequirementSkill.deleteMany({ where: { requirement: { shift: { companyId } } } }),
      this.prisma.shiftRequirementCertification.deleteMany({ where: { requirement: { shift: { companyId } } } }),
      this.prisma.shiftRequirement.deleteMany({ where: { shift: { companyId } } }),
      this.prisma.shift.deleteMany({ where: { companyId } }),
      this.prisma.scheduleVersion.deleteMany({ where: { schedule: { companyId } } }),
      this.prisma.schedule.deleteMany({ where: { companyId } }),
      this.prisma.employeeSkill.deleteMany({ where: { employee: { companyId } } }),
      this.prisma.employeeCertification.deleteMany({ where: { employee: { companyId } } }),
      this.prisma.availabilityException.deleteMany({ where: { companyId } }),
      this.prisma.availabilityRule.deleteMany({ where: { companyId } }),
      this.prisma.employee.deleteMany({ where: { companyId } }),
      this.prisma.team.deleteMany({ where: { companyId } }),
      this.prisma.department.deleteMany({ where: { companyId } }),
      this.prisma.branch.deleteMany({ where: { companyId } }),
      this.prisma.position.deleteMany({ where: { companyId } }),
      this.prisma.employmentType.deleteMany({ where: { companyId } }),
      this.prisma.skill.deleteMany({ where: { companyId } }),
      this.prisma.certification.deleteMany({ where: { companyId } }),
      this.prisma.holiday.deleteMany({ where: { companyId } }),
      this.prisma.geofence.deleteMany({ where: { companyId } }),
      this.prisma.featureFlag.deleteMany({ where: { companyId } }),
      this.prisma.activityAssignment.deleteMany({ where: { activity: { companyId } } }),
      this.prisma.activity.deleteMany({ where: { companyId } }),
      this.prisma.activityType.deleteMany({ where: { companyId } }),
      this.prisma.documentVersion.deleteMany({ where: { document: { companyId } } }),
      this.prisma.document.deleteMany({ where: { companyId } }),
      this.prisma.documentCategory.deleteMany({ where: { companyId } }),
      this.prisma.announcementAcknowledgment.deleteMany({ where: { announcement: { companyId } } }),
      this.prisma.announcement.deleteMany({ where: { companyId } }),
      this.prisma.notificationPreference.deleteMany({ where: { membership: { companyId } } }),
      this.prisma.userPermissionOverride.deleteMany({ where: { membership: { companyId } } }),
      this.prisma.rolePermission.deleteMany({ where: { role: { companyId } } }),
      this.prisma.userRole.deleteMany({ where: { membership: { companyId } } }),
      this.prisma.accessScope.deleteMany({ where: { membership: { companyId } } }),
      this.prisma.companyMembership.deleteMany({ where: { companyId } }),
      this.prisma.refreshToken.deleteMany({ where: { user: { memberships: { some: { companyId } } } } }),
      this.prisma.role.deleteMany({ where: { companyId } }),
      this.prisma.subscription.deleteMany({ where: { companyId } }),
      this.prisma.invoice.deleteMany({ where: { companyId } }),
      this.prisma.billingEvent.deleteMany({ where: { companyId } }),
      this.prisma.company.delete({ where: { id: companyId } }),
    ];
    await Promise.all(deletes.map((p) => p.catch(() => {})));
  }

  async cleanupUser(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return;

    await this.prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    const memberships = await this.prisma.companyMembership.findMany({
      where: { userId: user.id },
      select: { id: true, companyId: true },
    });

    for (const m of memberships) {
      await this.prisma.notificationPreference.deleteMany({ where: { membershipId: m.id } });
      await this.prisma.userPermissionOverride.deleteMany({ where: { membershipId: m.id } });
      await this.prisma.accessScope.deleteMany({ where: { membershipId: m.id } });
      await this.prisma.userRole.deleteMany({ where: { membershipId: m.id } });
      await this.prisma.companyMembership.delete({ where: { id: m.id } });
    }

    await this.prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }

  private async findOrCreateRole(companyId: string, name: string, code: string) {
    const existing = await this.prisma.role.findFirst({
      where: { companyId, code, isSystemRole: true },
    });
    if (existing) return existing;

    return this.prisma.role.create({
      data: { companyId, name, code, isSystemRole: true },
    });
  }

  private async linkRolePermissions(roleId: string, roleCode: string) {
    const { ROLE_PERMISSION_TEMPLATES } = await import(
      'C:/Users/HP ELITEBOOK 745 G6/Herd/Shift-Management-System/packages/shared/dist/index.js'
    );
    const actions = ROLE_PERMISSION_TEMPLATES[roleCode] ?? [];
    if (actions.length === 0) return;

    const permissions = await this.prisma.permission.findMany({
      where: { action: { in: [...actions] } },
      select: { id: true },
    });

    if (permissions.length > 0) {
      await this.prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
  }

  private async getDefaultEmploymentType(companyId: string) {
    const existing = await this.prisma.employmentType.findFirst({
      where: { companyId, code: 'FT' },
    });
    if (existing) return existing;

    return this.prisma.employmentType.create({
      data: { companyId, name: 'Full Time', code: 'FT' },
    });
  }

  async getDefaultBranch(companyId: string) {
    return this.prisma.branch.findFirst({ where: { companyId, code: 'MAIN' } });
  }
}
