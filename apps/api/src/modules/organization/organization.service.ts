import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ScopeFilterService } from '../authorization/scope-filter.service';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeFilter: ScopeFilterService,
  ) {}

  // ---- Branches ----
  async getBranches(companyId: string, membershipId?: string) {
    const where: Record<string, any> = { companyId, isActive: true };

    // ADR-003: org nodes are only reachable downward from the caller's grant.
    // A department/team/self-scoped caller sees no branch rows (the branch is
    // an ancestor, not a descendant), which is the intended fail-closed shape.
    if (membershipId) {
      const scopeWhere = await this.scopeFilter.branchWhere(membershipId, companyId);
      if (scopeWhere) {
        where.AND = [scopeWhere];
      }
    }

    return this.prisma.branch.findMany({
      where,
      include: {
        departments: {
          include: {
            teams: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createBranch(
    companyId: string,
    data: { name: string; code: string; timezone?: string; address?: string },
  ) {
    const existing = await this.prisma.branch.findUnique({
      where: { companyId_code: { companyId, code: data.code } },
    });
    if (existing) {
      throw new ConflictException(`Branch code '${data.code}' already exists`);
    }

    return this.prisma.branch.create({
      data: {
        companyId,
        name: data.name,
        code: data.code,
        timezone: data.timezone || 'UTC',
        address: data.address,
      },
    });
  }

  // ---- Departments ----
  async getDepartments(companyId: string, branchId?: string, membershipId?: string) {
    const where: Record<string, any> = {
      companyId,
      branchId: branchId || undefined,
      isActive: true,
    };

    if (membershipId) {
      const scopeWhere = await this.scopeFilter.departmentWhere(membershipId, companyId);
      if (scopeWhere) {
        where.AND = [scopeWhere];
      }
    }

    return this.prisma.department.findMany({
      where,
      include: {
        branch: true,
        teams: true,
        manager: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async createDepartment(
    companyId: string,
    data: { branchId: string; name: string; code: string; managerId?: string },
  ) {
    const existing = await this.prisma.department.findUnique({
      where: { companyId_code: { companyId, code: data.code } },
    });
    if (existing) {
      throw new ConflictException(`Department code '${data.code}' already exists`);
    }

    // Tenant-FK validation: the parent branch must belong to the company.
    const branch = await this.prisma.branch.findFirst({
      where: { id: data.branchId, companyId },
      select: { id: true },
    });
    if (!branch) {
      throw new NotFoundException('Branch does not belong to this company');
    }

    return this.prisma.department.create({
      data: {
        companyId,
        branchId: data.branchId,
        name: data.name,
        code: data.code,
        managerId: data.managerId,
      },
    });
  }

  // ---- Teams ----
  async getTeams(companyId: string, departmentId?: string, membershipId?: string) {
    const where: Record<string, any> = {
      companyId,
      departmentId: departmentId || undefined,
      isActive: true,
    };

    if (membershipId) {
      const scopeWhere = await this.scopeFilter.teamWhere(membershipId, companyId);
      if (scopeWhere) {
        where.AND = [scopeWhere];
      }
    }

    return this.prisma.team.findMany({
      where,
      include: {
        department: true,
        manager: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async createTeam(
    companyId: string,
    data: { departmentId: string; name: string; code: string; managerId?: string },
  ) {
    const existing = await this.prisma.team.findUnique({
      where: { companyId_code: { companyId, code: data.code } },
    });
    if (existing) {
      throw new ConflictException(`Team code '${data.code}' already exists`);
    }

    // Tenant-FK validation: the parent department must belong to the company.
    const department = await this.prisma.department.findFirst({
      where: { id: data.departmentId, companyId },
      select: { id: true },
    });
    if (!department) {
      throw new NotFoundException('Department does not belong to this company');
    }

    return this.prisma.team.create({
      data: {
        companyId,
        departmentId: data.departmentId,
        name: data.name,
        code: data.code,
        managerId: data.managerId,
      },
    });
  }

  // ---- Positions ----
  async getPositions(companyId: string, membershipId?: string) {
    const where: Record<string, any> = { companyId, isActive: true };

    if (membershipId) {
      const scopeWhere = await this.scopeFilter.positionWhere(membershipId, companyId);
      if (scopeWhere) {
        where.AND = [scopeWhere];
      }
    }

    return this.prisma.position.findMany({
      where,
      include: { department: true },
      orderBy: { name: 'asc' },
    });
  }

  // ---- Employment Types ----
  async getEmploymentTypes(companyId: string) {
    return this.prisma.employmentType.findMany({
      where: { companyId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }
}
