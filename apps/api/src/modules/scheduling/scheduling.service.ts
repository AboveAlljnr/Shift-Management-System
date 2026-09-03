import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type {
  CreateShiftDto,
  AssignShiftDto,
  ShiftConflictOverrideDto,
} from '@sms/shared';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ScopeFilterService } from '../authorization/scope-filter.service';

export interface Conflict {
  type: string;
  severity: 'WARNING' | 'BLOCKING';
  employeeId?: string;
  shiftId: string;
  relatedShiftId?: string;
  ruleIdentifier: string;
  message: string;
  overrideAllowed: boolean;
  metadata?: Record<string, any>;
}

export interface ScheduleValidationResult {
  isValid: boolean;
  conflicts: Conflict[];
  warnings: Conflict[];
}

@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeFilter: ScopeFilterService,
  ) {}

  async findAll(
    companyId: string,
    filters: {
      branchId?: string;
      departmentId?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
    },
    membershipId: string,
  ) {
    const where: Record<string, any> = { companyId };

    // ADR-003 query scope: restrict listed shifts to the caller's granted
    // branches/departments/teams (or their own assignments) AND-scoped against
    // any client-supplied filters below. The nested assignments include is
    // scoped too (via the employee relation), so a branch/self-scoped caller
    // never sees employees outside their scope inside an in-scope shift.
    const queryScope = await this.scopeFilter.shiftQueryScope(membershipId, companyId);
    let assignmentsWhere: { employee: Record<string, any> } | undefined;
    if (queryScope.shiftWhere) {
      where.AND = [queryScope.shiftWhere];
      if (queryScope.assignmentEmployeeWhere) {
        assignmentsWhere = { employee: queryScope.assignmentEmployeeWhere };
      }
    }

    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.departmentId) where.departmentId = filters.departmentId;
    if (filters.status) where.status = filters.status;
    if (filters.startDate || filters.endDate) {
      where.startAt = {};
      if (filters.startDate) where.startAt.gte = new Date(filters.startDate);
      if (filters.endDate) where.startAt.lte = new Date(filters.endDate);
    }

    return this.prisma.shift.findMany({
      where,
      orderBy: { startAt: 'asc' },
      include: {
        branch: true,
        department: true,
        team: true,
        requirements: {
          include: {
            position: true,
            skills: { include: { skill: true } },
            certifications: { include: { certification: true } },
          },
        },
        assignments: assignmentsWhere
          ? { where: assignmentsWhere, include: { employee: true } }
          : { include: { employee: true } },
        conflictOverrides: true,
      },
    });
  }

  async findById(companyId: string, id: string, membershipId?: string) {
    const where: Record<string, any> = { id, companyId };
    let assignmentsWhere: { employee: Record<string, any> } | undefined;

    if (membershipId) {
      const queryScope = await this.scopeFilter.shiftQueryScope(membershipId, companyId);
      if (queryScope.shiftWhere) {
        where.AND = [queryScope.shiftWhere];
        if (queryScope.assignmentEmployeeWhere) {
          assignmentsWhere = { employee: queryScope.assignmentEmployeeWhere };
        }
      }
    }

    const shift = await this.prisma.shift.findFirst({
      where,
      include: {
        branch: true,
        department: true,
        team: true,
        requirements: {
          include: {
            position: true,
            skills: { include: { skill: true } },
            certifications: { include: { certification: true } },
          },
        },
        assignments: assignmentsWhere
          ? { where: assignmentsWhere, include: { employee: true } }
          : { include: { employee: true } },
        conflictOverrides: {
          include: {
            overriddenBy: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        history: true,
      },
    });

    if (!shift) {
      throw new NotFoundException(`Shift with ID ${id} not found`);
    }

    return shift;
  }

  async create(companyId: string, dto: CreateShiftDto) {
    // Tenant-FK validation: the shift's organizational nodes must belong to the
    // company, otherwise a shift could be created under another tenant's org.
    const where = { companyId };
    const select = { id: true };

    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, ...where },
        select,
      });
      if (!branch) {
        throw new NotFoundException('branch does not belong to this company');
      }
    }

    if (dto.departmentId) {
      const department = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, ...where },
        select,
      });
      if (!department) {
        throw new NotFoundException('department does not belong to this company');
      }
    }

    if (dto.teamId) {
      const team = await this.prisma.team.findFirst({
        where: { id: dto.teamId, ...where },
        select,
      });
      if (!team) {
        throw new NotFoundException('team does not belong to this company');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const shift = await tx.shift.create({
        data: {
          companyId,
          branchId: dto.branchId,
          departmentId: dto.departmentId,
          teamId: dto.teamId,
          name: dto.name,
          startAt: new Date(dto.startAt),
          endAt: new Date(dto.endAt),
          isOvernight: dto.isOvernight,
          isRecurring: dto.isRecurring,
          recurrenceRule: dto.recurrenceRule,
          notes: dto.notes,
        },
      });

      if (dto.requirements && dto.requirements.length > 0) {
        for (const req of dto.requirements) {
          const requirement = await tx.shiftRequirement.create({
            data: {
              shiftId: shift.id,
              headcount: req.headcount,
              positionId: req.positionId,
              branchConstraint: req.branchConstraint,
            },
          });

          if (req.skillIds && req.skillIds.length > 0) {
            await tx.shiftRequirementSkill.createMany({
              data: req.skillIds.map((skillId) => ({
                requirementId: requirement.id,
                skillId,
              })),
            });
          }

          if (req.certificationIds && req.certificationIds.length > 0) {
            await tx.shiftRequirementCertification.createMany({
              data: req.certificationIds.map((certificationId) => ({
                requirementId: requirement.id,
                certificationId,
              })),
            });
          }
        }
      }

      return shift;
    });
  }

  async validateAssignment(
    companyId: string,
    shiftId: string,
    employeeId: string,
  ): Promise<ScheduleValidationResult> {
    const shift = await this.findById(companyId, shiftId);
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: {
        skills: true,
        certifications: true,
        availabilityRules: true,
        availabilityExceptions: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID ${employeeId} not found`);
    }

    const conflicts: Conflict[] = [];
    const warnings: Conflict[] = [];

    // 1. Check if employee is active (BLOCKING)
    if (employee.status !== 'active') {
      conflicts.push({
        type: 'INACTIVE_EMPLOYEE',
        severity: 'BLOCKING',
        employeeId,
        shiftId,
        ruleIdentifier: 'EMPLOYEE_STATUS',
        message: `Employee ${employee.firstName} ${employee.lastName} is not active (${employee.status})`,
        overrideAllowed: false,
      });
    }

    // 2. Check for overlapping shifts (BLOCKING)
    const overlapping = await this.prisma.shiftAssignment.findFirst({
      where: {
        employeeId,
        shift: {
          id: { not: shiftId },
          companyId,
          status: { not: 'cancelled' },
          AND: [
            { startAt: { lt: shift.endAt } },
            { endAt: { gt: shift.startAt } },
          ],
        },
      },
      include: { shift: true },
    });

    if (overlapping) {
      conflicts.push({
        type: 'OVERLAPPING_SHIFT',
        severity: 'BLOCKING',
        employeeId,
        shiftId,
        relatedShiftId: overlapping.shiftId,
        ruleIdentifier: 'SHIFT_OVERLAP',
        message: `Employee already assigned to overlapping shift '${overlapping.shift.name}'`,
        overrideAllowed: false,
      });
    }

    // 3. Check for approved leave (BLOCKING)
    const overlappingLeave = await this.prisma.leaveRequest.findFirst({
      where: {
        employeeId,
        companyId,
        status: 'approved',
        startDate: { lte: shift.endAt },
        endDate: { gte: shift.startAt },
      },
    });

    if (overlappingLeave) {
      conflicts.push({
        type: 'APPROVED_LEAVE',
        severity: 'BLOCKING',
        employeeId,
        shiftId,
        ruleIdentifier: 'LEAVE_CONSTRAINTS',
        message: `Employee has approved leave during this shift period`,
        overrideAllowed: false,
      });
    }

    // 4. Check for availability exceptions (WARNING)
    const shiftDate = new Date(shift.startAt);
    const exception = employee.availabilityExceptions.find(
      (ex) =>
        new Date(ex.date).toISOString().slice(0, 10) ===
        shiftDate.toISOString().slice(0, 10),
    );

    if (exception && !exception.isAvailable) {
      warnings.push({
        type: 'AVAILABILITY_EXCEPTION',
        severity: 'WARNING',
        employeeId,
        shiftId,
        ruleIdentifier: 'AVAILABILITY_EXCEPTION',
        message: `Employee marked unavailable on ${shiftDate.toISOString().slice(0, 10)}: ${exception.reason || 'No reason given'}`,
        overrideAllowed: true,
      });
    }

    // 5. Check minimum rest period (11 hours default) (WARNING)
    const minRestHours = 11;
    const restWindowStart = new Date(shift.startAt.getTime() - minRestHours * 3600 * 1000);
    const restWindowEnd = new Date(shift.endAt.getTime() + minRestHours * 3600 * 1000);

    const adjacentShift = await this.prisma.shiftAssignment.findFirst({
      where: {
        employeeId,
        shift: {
          id: { not: shiftId },
          companyId,
          status: { not: 'cancelled' },
          OR: [
            { endAt: { gt: restWindowStart, lte: shift.startAt } },
            { startAt: { gte: shift.endAt, lt: restWindowEnd } },
          ],
        },
      },
      include: { shift: true },
    });

    if (adjacentShift) {
      warnings.push({
        type: 'MIN_REST',
        severity: 'WARNING',
        employeeId,
        shiftId,
        relatedShiftId: adjacentShift.shiftId,
        ruleIdentifier: 'MIN_REST_HOURS',
        message: `Rest period between consecutive shifts is less than ${minRestHours} hours`,
        overrideAllowed: true,
      });
    }

    return {
      isValid: conflicts.length === 0,
      conflicts,
      warnings,
    };
  }

  async assign(
    companyId: string,
    shiftId: string,
    dto: AssignShiftDto,
    _userId: string,
  ) {
    const validation = await this.validateAssignment(companyId, shiftId, dto.employeeId);

    if (validation.conflicts.length > 0) {
      throw new BadRequestException({
        message: 'Assignment has blocking conflicts',
        conflicts: validation.conflicts,
      });
    }

    if (validation.warnings.length > 0) {
      throw new BadRequestException({
        message: 'Assignment has warnings that require explicit override',
        warnings: validation.warnings,
        requiresOverride: true,
      });
    }

    return this.prisma.shiftAssignment.create({
      data: {
        shiftId,
        employeeId: dto.employeeId,
        status: 'scheduled',
        notes: dto.notes,
      },
      include: {
        employee: true,
        shift: true,
      },
    });
  }

  async overrideConflictAndAssign(
    companyId: string,
    dto: ShiftConflictOverrideDto,
    userId: string,
  ) {
    if (!dto.reason || dto.reason.trim().length < 3) {
      throw new BadRequestException('A valid reason is required to override scheduling conflicts');
    }

    if (!dto.employeeId) {
      throw new BadRequestException('Employee ID is required for conflict override');
    }

    return this.prisma.$transaction(async (tx) => {
      // Create override audit record (ADR-005)
      await tx.shiftConflictOverride.create({
        data: {
          companyId,
          shiftId: dto.shiftId,
          employeeId: dto.employeeId,
          ruleIdentifier: dto.ruleIdentifier,
          severity: 'WARNING',
          reason: dto.reason,
          overriddenById: userId,
          metadata: (dto.metadata as any) || {},
        },
      });

      // Create assignment
      return tx.shiftAssignment.create({
        data: {
          shiftId: dto.shiftId,
          employeeId: dto.employeeId!,
          status: 'scheduled',
          notes: `Assigned with override: ${dto.reason}`,
        },
        include: {
          employee: true,
          shift: true,
        },
      });
    });
  }

  async publishSchedule(
    companyId: string,
    scheduleId: string,
    userId: string,
    notes?: string,
  ) {
    const schedule = await this.prisma.schedule.findFirst({
      where: { id: scheduleId, companyId },
      include: {
        shifts: {
          include: {
            assignments: { include: { employee: true } },
            requirements: true,
          },
        },
        versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
      },
    });

    if (!schedule) {
      throw new NotFoundException(`Schedule with ID ${scheduleId} not found`);
    }

    const nextVersionNumber =
      schedule.versions.length > 0 && schedule.versions[0]
        ? schedule.versions[0].versionNumber + 1
        : 1;

    return this.prisma.$transaction(async (tx) => {
      // 1. Create immutable snapshot version
      await tx.scheduleVersion.create({
        data: {
          scheduleId,
          versionNumber: nextVersionNumber,
          snapshotJson: schedule.shifts as any,
          publishedById: userId,
          notes,
        },
      });

      // 2. Update Schedule status
      await tx.schedule.update({
        where: { id: scheduleId },
        data: {
          status: 'published',
          publishedAt: new Date(),
        },
      });

      // 3. Mark all shifts as published
      await tx.shift.updateMany({
        where: { scheduleId, companyId },
        data: {
          status: 'published',
          publishedAt: new Date(),
          publishedById: userId,
        },
      });

      return { success: true, versionNumber: nextVersionNumber };
    });
  }
}
