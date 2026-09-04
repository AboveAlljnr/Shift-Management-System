import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import type {
  CreateAvailabilityRuleDto,
  UpdateAvailabilityRuleDto,
  CreateAvailabilityExceptionDto,
  UpdateAvailabilityExceptionDto,
} from '@sms/shared';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ScopeFilterService, isPlacementInScope } from '../authorization/scope-filter.service';

/**
 * Availability Management (ADR-005).
 *
 * Availability is owned per-employee (recurring weekly rules + one-off exceptions).
 * Read access is scoped to the member's granted branches/departments/teams/self via
 * the shared scope filter; write access requires the TARGET employee to fall inside
 * the member's scope (self-managed records, or team/branch records for managers).
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeFilter: ScopeFilterService,
  ) {}

  // ---- Rules ----

  async listRules(
    companyId: string,
    employeeId: string | undefined,
    membershipId: string,
  ) {
    const employeeWhere = await this.scopeFilter.employeeWhere(membershipId, companyId);
    const where: Record<string, any> = { companyId };
    if (employeeId) where.employeeId = employeeId;
    if (employeeWhere) {
      where.employee = employeeWhere;
    }

    return this.prisma.availabilityRule.findMany({
      where,
      orderBy: [{ employeeId: 'asc' }, { dayOfWeek: 'asc' }],
      include: { employee: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  }

  async createRule(companyId: string, dto: CreateAvailabilityRuleDto, membershipId: string) {
    await this.assertWriteScope(companyId, dto.employeeId, membershipId);

    if (toMinutes(dto.startTime) >= toMinutes(dto.endTime) && dto.isAvailable) {
      throw new BadRequestException('startTime must be before endTime for an available window');
    }

    return this.prisma.availabilityRule.create({
      data: {
        companyId,
        employeeId: dto.employeeId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        isAvailable: dto.isAvailable,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  }

  async updateRule(companyId: string, id: string, dto: UpdateAvailabilityRuleDto, membershipId: string) {
    const rule = await this.getRule(companyId, id);
    await this.assertWriteScope(companyId, rule.employeeId, membershipId);

    const startTime = dto.startTime ?? rule.startTime;
    const endTime = dto.endTime ?? rule.endTime;
    const isAvailable = dto.isAvailable ?? rule.isAvailable;
    if (toMinutes(startTime) >= toMinutes(endTime) && isAvailable) {
      throw new BadRequestException('startTime must be before endTime for an available window');
    }

    return this.prisma.availabilityRule.update({
      where: { id },
      data: {
        ...(dto.dayOfWeek !== undefined ? { dayOfWeek: dto.dayOfWeek } : {}),
        ...(dto.startTime ? { startTime: dto.startTime } : {}),
        ...(dto.endTime ? { endTime: dto.endTime } : {}),
        ...(dto.isAvailable !== undefined ? { isAvailable: dto.isAvailable } : {}),
        ...(dto.effectiveFrom ? { effectiveFrom: new Date(dto.effectiveFrom) } : {}),
        ...(dto.effectiveTo !== undefined
          ? { effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null }
          : {}),
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  }

  async deleteRule(companyId: string, id: string, membershipId: string) {
    const rule = await this.getRule(companyId, id);
    await this.assertWriteScope(companyId, rule.employeeId, membershipId);
    await this.prisma.availabilityRule.delete({ where: { id } });
    return { success: true };
  }

  // ---- Exceptions ----

  async listExceptions(
    companyId: string,
    employeeId: string | undefined,
    membershipId: string,
  ) {
    const employeeWhere = await this.scopeFilter.employeeWhere(membershipId, companyId);
    const where: Record<string, any> = { companyId };
    if (employeeId) where.employeeId = employeeId;
    if (employeeWhere) {
      where.employee = employeeWhere;
    }

    return this.prisma.availabilityException.findMany({
      where,
      orderBy: [{ employeeId: 'asc' }, { date: 'desc' }],
      include: { employee: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  }

  async createException(
    companyId: string,
    dto: CreateAvailabilityExceptionDto,
    membershipId: string,
  ) {
    await this.assertWriteScope(companyId, dto.employeeId, membershipId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.availabilityException.findFirst({
        where: {
          companyId,
          employeeId: dto.employeeId,
          date: new Date(dto.date),
        },
      });
      if (existing) {
        throw new BadRequestException('An availability exception already exists for this date');
      }
      return tx.availabilityException.create({
        data: {
          companyId,
          employeeId: dto.employeeId,
          date: new Date(dto.date),
          isAvailable: dto.isAvailable,
          startTime: dto.startTime ?? null,
          endTime: dto.endTime ?? null,
          reason: dto.reason ?? null,
        },
        include: { employee: { select: { id: true, firstName: true, lastName: true, email: true } } },
      });
    });
  }

  async updateException(
    companyId: string,
    id: string,
    dto: UpdateAvailabilityExceptionDto,
    membershipId: string,
  ) {
    const exception = await this.getException(companyId, id);
    await this.assertWriteScope(companyId, exception.employeeId, membershipId);

    return this.prisma.availabilityException.update({
      where: { id },
      data: {
        ...(dto.date ? { date: new Date(dto.date) } : {}),
        ...(dto.isAvailable !== undefined ? { isAvailable: dto.isAvailable } : {}),
        ...(dto.startTime !== undefined ? { startTime: dto.startTime ?? null } : {}),
        ...(dto.endTime !== undefined ? { endTime: dto.endTime ?? null } : {}),
        ...(dto.reason !== undefined ? { reason: dto.reason ?? null } : {}),
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  }

  async deleteException(companyId: string, id: string, membershipId: string) {
    const exception = await this.getException(companyId, id);
    await this.assertWriteScope(companyId, exception.employeeId, membershipId);
    await this.prisma.availabilityException.delete({ where: { id } });
    return { success: true };
  }

  // ---- Helpers ----

  private async getRule(companyId: string, id: string) {
    const rule = await this.prisma.availabilityRule.findFirst({
      where: { id, companyId },
    });
    if (!rule) throw new NotFoundException(`Availability rule with ID ${id} not found`);
    return rule;
  }

  private async getException(companyId: string, id: string) {
    const exception = await this.prisma.availabilityException.findFirst({
      where: { id, companyId },
    });
    if (!exception) throw new NotFoundException(`Availability exception with ID ${id} not found`);
    return exception;
  }

  /**
   * Write-scope guard (ADR-003): the target employee must lie within the member's
   * granted scope (self, or their branch/department/team). Company-wide members
   * are unrestricted.
   */
  private async assertWriteScope(companyId: string, employeeId: string, membershipId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: {
        id: true,
        branchId: true,
        departmentId: true,
        teamId: true,
      },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const { unrestricted, buckets } = await this.scopeFilter.resolveScope(membershipId, companyId);
    if (unrestricted) return;
    const placement = {
      branchId: employee.branchId,
      departmentId: employee.departmentId,
      teamId: employee.teamId,
      employeeId: employee.id,
    };
    if (!isPlacementInScope(buckets, placement)) {
      throw new ForbiddenException('Employee is outside your organizational scope');
    }
  }
}

/** Convert 'HH:mm' to minutes since midnight. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => Number(n));
  return (h || 0) * 60 + (m || 0);
}
