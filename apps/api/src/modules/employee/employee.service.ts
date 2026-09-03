import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  PaginationQueryDto,
} from '@sms/shared';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ScopeFilterService } from '../authorization/scope-filter.service';
import { isPlacementInScope } from '../authorization/scope-filter.service';
import type { OrgPlacement } from '../authorization/scope-filter.service';

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeFilter: ScopeFilterService,
  ) {}

  async findAll(companyId: string, query: PaginationQueryDto, membershipId: string) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const { search, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, any> = {
      companyId,
    };

    // ADR-003 query scope: constrain the tenant query to the caller's granted
    // branch/department/team/self buckets. Shared by findMany and count so the
    // pagination total reflects the scoped data.
    const scopeWhere = await this.scopeFilter.employeeWhere(membershipId, companyId);
    if (scopeWhere) {
      where.AND = [scopeWhere];
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { employeeNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          branch: true,
          department: true,
          team: true,
          primaryPosition: true,
          employmentType: true,
        },
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
      },
    };
  }

  async findById(companyId: string, id: string, membershipId?: string) {
    const where: Record<string, any> = { id, companyId };

    // Only the read path passes a membership; scoping is an AND-intersection,
    // so an in-scope id still resolves while an out-of-scope id returns 404.
    if (membershipId) {
      const scopeWhere = await this.scopeFilter.employeeWhere(membershipId, companyId);
      if (scopeWhere) {
        where.AND = [scopeWhere];
      }
    }

    const employee = await this.prisma.employee.findFirst({
      where,
      include: {
        branch: true,
        department: true,
        team: true,
        primaryPosition: true,
        employmentType: true,
        manager: true,
        directReports: true,
        skills: { include: { skill: true } },
        certifications: { include: { certification: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    return employee;
  }

  async create(companyId: string, dto: CreateEmployeeDto, membershipId?: string) {
    // ADR-003 write scope: the resulting placement must fall inside the caller's
    // effective scope (a grant-less/self member cannot create; a branch manager
    // may only create into their own branch & descendants).
    if (membershipId) {
      await this.assertWriteInScope(membershipId, companyId, {
        branchId: dto.branchId,
        departmentId: dto.departmentId,
        teamId: dto.teamId,
      });
    }

    // Check employee number uniqueness within company
    const existing = await this.prisma.employee.findUnique({
      where: {
        companyId_employeeNumber: {
          companyId,
          employeeNumber: dto.employeeNumber,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Employee number ${dto.employeeNumber} is already in use`);
    }

    // Check billing seat limit (ADR-008: Active Employee Count)
    const activeCount = await this.prisma.employee.count({
      where: { companyId, status: 'active' },
    });

    const subscription = await this.prisma.subscription.findUnique({
      where: { companyId },
      include: { plan: true },
    });

    if (subscription && activeCount >= subscription.plan.maxEmployees) {
      // Soft block / warning: can be configured as exception or warning
      throw new ForbiddenException(
        `Active employee limit reached (${subscription.plan.maxEmployees} seats). Please upgrade your plan.`,
      );
    }

    // Tenant-FK validation (tenant isolation, ADR-002): every referenced
    // organizational node must belong to the same company, otherwise an
    // employee could be silently attached to another tenant's hierarchy.
    const employmentType = await this.prisma.employmentType.findFirst({
      where: { id: dto.employmentTypeId, companyId },
      select: { id: true },
    });
    if (!employmentType) {
      throw new NotFoundException('Employment type does not belong to this company');
    }
    await this.assertOrgNodeBelongsToCompany(dto.branchId, 'branch', companyId);
    await this.assertOrgNodeBelongsToCompany(dto.departmentId, 'department', companyId);
    await this.assertOrgNodeBelongsToCompany(dto.teamId, 'team', companyId);

    return this.prisma.employee.create({
      data: {
        companyId,
        employeeNumber: dto.employeeNumber,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        employmentTypeId: dto.employmentTypeId,
        branchId: dto.branchId,
        departmentId: dto.departmentId,
        teamId: dto.teamId,
        primaryPositionId: dto.primaryPositionId,
        managerId: dto.managerId,
        hireDate: new Date(dto.hireDate),
      },
      include: {
        branch: true,
        department: true,
        primaryPosition: true,
        employmentType: true,
      },
    });
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateEmployeeDto,
    membershipId?: string,
  ) {
    const current = await this.findById(companyId, id);

    if (membershipId) {
      // ADR-003 write scope, checked against the TARGET employee record (rule:
      // never trust a client-supplied org id to widen scope). Both the CURRENT
      // placement (the record being mutated) and the RESULTING placement (any
      // org-field move) must be inside the caller's effective scope, so a
      // scoped member can relocate within their scope but never into/out of it.
      await this.assertWriteInScope(membershipId, companyId, {
        branchId: current.branchId,
        departmentId: current.departmentId,
        teamId: current.teamId,
        employeeId: current.id,
      });
      await this.assertWriteInScope(membershipId, companyId, {
        branchId: dto.branchId ?? current.branchId,
        departmentId: dto.departmentId ?? current.departmentId,
        teamId: dto.teamId ?? current.teamId,
        employeeId: current.id,
      });

      // Tenant-FK (ADR-002) parity with create: supplied org nodes and the
      // employment type must belong to the company, otherwise an update could
      // silently attach the employee to another tenant's hierarchy.
      if (dto.employmentTypeId) {
        const employmentType = await this.prisma.employmentType.findFirst({
          where: { id: dto.employmentTypeId, companyId },
          select: { id: true },
        });
        if (!employmentType) {
          throw new NotFoundException('Employment type does not belong to this company');
        }
      }
      await this.assertOrgNodeBelongsToCompany(dto.branchId, 'branch', companyId);
      await this.assertOrgNodeBelongsToCompany(dto.departmentId, 'department', companyId);
      await this.assertOrgNodeBelongsToCompany(dto.teamId, 'team', companyId);
    }

    return this.prisma.employee.update({
      where: { id },
      data: {
        ...dto,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
      },
      include: {
        branch: true,
        department: true,
        primaryPosition: true,
        employmentType: true,
      },
    });
  }

  async deactivate(companyId: string, id: string, membershipId?: string) {
    const current = await this.findById(companyId, id);

    if (membershipId) {
      await this.assertWriteInScope(membershipId, companyId, {
        branchId: current.branchId,
        departmentId: current.departmentId,
        teamId: current.teamId,
        employeeId: current.id,
      });
    }

    return this.prisma.employee.update({
      where: { id },
      data: {
        status: 'inactive',
        terminationDate: new Date(),
      },
    });
  }

  /**
   * ADR-003 write guard: throws FORBIDDEN unless the caller's effective scope
   * covers the placement (company-wide scope is unrestricted within the tenant).
   */
  private async assertWriteInScope(
    membershipId: string,
    companyId: string,
    placement: OrgPlacement,
  ): Promise<void> {
    const { unrestricted, buckets } = await this.scopeFilter.resolveScope(membershipId, companyId);
    if (unrestricted) return;
    if (!isPlacementInScope(buckets, placement)) {
      throw new ForbiddenException('Employee is outside your organizational scope');
    }
  }

  /**
   * Tenant-FK guard: verifies an organizational node belongs to the company.
   * A falsy id is allowed (node is optional); a non-empty id must resolve.
   */
  private async assertOrgNodeBelongsToCompany(
    nodeId: string | undefined | null,
    model: 'branch' | 'department' | 'team',
    companyId: string,
  ): Promise<void> {
    if (!nodeId) return;

    const where = { id: nodeId, companyId };
    const select = { id: true };
    let record: { id: string } | null;

    if (model === 'branch') {
      record = await this.prisma.branch.findFirst({ where, select });
    } else if (model === 'department') {
      record = await this.prisma.department.findFirst({ where, select });
    } else {
      record = await this.prisma.team.findFirst({ where, select });
    }

    if (!record) {
      throw new NotFoundException(`${model} does not belong to this company`);
    }
  }
}
