import { randomUUID } from 'node:crypto';

import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type {
  CreateShiftDto,
  AssignShiftDto,
  ShiftConflictOverrideDto,
  OptimizeScheduleDto,
  OptimizeApplyDto,
} from '@sms/shared';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { OptimizerClient } from '../../infrastructure/optimizer/optimizer.client';
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

export interface SuggestionAssignment {
  shiftId: string;
  employeeId: string;
  blocking: Conflict[];
  warnings: Conflict[];
}

export interface ScheduleSuggestion {
  status: string;
  shiftsConsidered: number;
  suggestedCount: number;
  unfilledShifts: string[];
  droppedBlocking: number;
  solverTimeSeconds: number;
  objectiveValue?: number;
  assignments: SuggestionAssignment[];
}

const MIN_REST_HOURS = 11;

@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeFilter: ScopeFilterService,
    private readonly optimizer: OptimizerClient,
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

  /**
   * Generate Suggested Schedule (Hackathon).
   *
   * The optimizer microservice is a PROPOSER only. This method:
   *  1. Loads in-scope shifts + candidate employees (ADR-003 scoped).
   *  2. Computes authoritative per-employee availability: a shift is only offered
   *     to an employee when it does not clash with an approved leave, an existing
   *     (non-cancelled) assignment, a prior assignment in the same window, or a
   *     minimum-rest violation against existing assignments.
   *  3. Sends the deterministic request to the optimizer and revalidates every
   *     proposed pair through the authoritative conflict engine, dropping any that
   *     still carry a BLOCKING conflict.
   *  4. Persists an OptimizationRequest audit record (interactive path).
   *
   * Nothing is written to the production schedule tables here; suggestions must be
   * explicitly applied via `applySuggestions` (review-first).
   */
  async generateSuggestions(
    companyId: string,
    dto: OptimizeScheduleDto,
    userId: string,
    membershipId: string,
  ): Promise<ScheduleSuggestion> {
    const idempotencyKey = randomUUID();

    const queryScope = await this.scopeFilter.shiftQueryScope(membershipId, companyId);
    const shiftWhere: Record<string, any> = {
      companyId,
      branchId: dto.branchId,
      status: { not: 'cancelled' },
      startAt: {},
    };
    if (queryScope.shiftWhere) shiftWhere.AND = [queryScope.shiftWhere];
    if (dto.departmentId) shiftWhere.departmentId = dto.departmentId;
    if (dto.teamId) shiftWhere.teamId = dto.teamId;
    if (dto.startDate) shiftWhere.startAt.gte = new Date(dto.startDate);
    if (dto.endDate) shiftWhere.startAt.lte = new Date(dto.endDate);

    const shifts = await this.prisma.shift.findMany({
      where: shiftWhere,
      include: { requirements: true, assignments: true },
      orderBy: { startAt: 'asc' },
    });

    if (shifts.length === 0) {
      return {
        status: 'no_shifts',
        shiftsConsidered: 0,
        suggestedCount: 0,
        unfilledShifts: [],
        droppedBlocking: 0,
        solverTimeSeconds: 0,
        assignments: [],
      };
    }

    const employeeWhere = await this.scopeFilter.employeeWhere(membershipId, companyId);
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        status: 'active',
        ...(employeeWhere ?? {}),
      },
    });

    const windowStart = new Date(dto.startDate);
    const windowEnd = new Date(dto.endDate);
    const employeeIds = employees.map((e) => e.id);

    // Authoritative conflict lookups for the whole window.
    const [approvedLeaves, existingAssignments] = await Promise.all([
      employeeIds.length
        ? this.prisma.leaveRequest.findMany({
            where: {
              companyId,
              status: 'approved',
              employeeId: { in: employeeIds },
              startDate: { lte: windowEnd },
              endDate: { gte: windowStart },
            },
          })
        : Promise.resolve([]),
      shifts.length
        ? this.prisma.shiftAssignment.findMany({
            where: {
              shiftId: { in: shifts.map((s) => s.id) },
              status: { not: 'cancelled' },
            },
          })
        : Promise.resolve([]),
    ]);

    const availability = this.buildAvailability(
      shifts,
      employees,
      approvedLeaves,
      existingAssignments,
    );

    const request = {
      tenant_id: companyId,
      week_start: dto.startDate.slice(0, 10),
      shifts: shifts.map((s) => ({
        shift_id: s.id,
        start_time: s.startAt.toISOString(),
        end_time: s.endAt.toISOString(),
        required_count:
          s.requirements.length > 0
            ? s.requirements.reduce((sum, r) => sum + r.headcount, 0)
            : 1,
        department_id: s.departmentId ?? undefined,
      })),
      employees: employees.map((e) => ({
        employee_id: e.id,
        available_shift_ids: availability.get(e.id) ?? [],
        max_hours_per_week: 40,
        min_hours_per_week: 0,
      })),
      max_solver_time_seconds: 30,
      min_rest_hours: MIN_REST_HOURS,
    };

    const optimizerResult = await this.optimizer.optimize(request);

    // Revalidate every proposed pair against the authoritative engine; block unsafe ones.
    const assignments: SuggestionAssignment[] = [];
    let droppedBlocking = 0;
    for (const a of optimizerResult.assignments) {
      const validation = await this.validateAssignment(companyId, a.shift_id, a.employee_id);
      const blocking = validation.conflicts;
      if (blocking.length > 0) {
        droppedBlocking += 1;
        continue;
      }
      assignments.push({
        shiftId: a.shift_id,
        employeeId: a.employee_id,
        blocking: [],
        warnings: validation.warnings,
      });
    }

    const suggestedShiftIds = new Set(assignments.map((a) => a.shiftId));
    const unfilledShifts = shifts
      .map((s) => s.id)
      .filter((id) => !suggestedShiftIds.has(id));

    const suggestion: ScheduleSuggestion = {
      status: optimizerResult.status,
      shiftsConsidered: shifts.length,
      suggestedCount: assignments.length,
      unfilledShifts,
      droppedBlocking,
      solverTimeSeconds: optimizerResult.solver_time_seconds,
      objectiveValue: optimizerResult.objective_value,
      assignments,
    };

    await this.prisma.optimizationRequest.create({
      data: {
        companyId,
        requestedById: userId,
        parameters: JSON.parse(JSON.stringify(request)),
        status: 'completed',
        path: 'interactive',
        idempotencyKey,
        resultJson: JSON.parse(JSON.stringify(suggestion)),
        completedAt: new Date(),
      },
    });

    return suggestion;
  }

  /**
   * Apply Suggested Schedule (review-first, transactional).
   *
   * Each proposed pair is revalidated through the authoritative engine at apply time.
   * Pairs with BLOCKING conflicts are skipped (never silently overwritten); pairs that
   * already exist are reported as skipped. Only clean pairs are written, all within a
   * single transaction so a partial failure cannot leave a half-applied schedule.
   */
  async applySuggestions(
    companyId: string,
    dto: OptimizeApplyDto,
    userId: string,
  ) {
    const result = {
      accepted: [] as SuggestionAssignment[],
      skipped: [] as { shiftId: string; employeeId: string; reason: string }[],
      rejected: [] as { shiftId: string; employeeId: string; conflicts: Conflict[] }[],
    };

    await this.prisma.$transaction(async (tx) => {
      for (const pair of dto.assignments) {
        const exists = await tx.shiftAssignment.findFirst({
          where: {
            shiftId: pair.shiftId,
            employeeId: pair.employeeId,
            status: { not: 'cancelled' },
          },
        });

        if (exists) {
          result.skipped.push({ ...pair, reason: 'already_assigned' });
          continue;
        }

        const validation = await this.validateAssignment(companyId, pair.shiftId, pair.employeeId);
        const blocking = validation.conflicts;
        if (blocking.length > 0) {
          result.rejected.push({ ...pair, conflicts: blocking });
          continue;
        }

        await tx.shiftAssignment.create({
          data: {
            shiftId: pair.shiftId,
            employeeId: pair.employeeId,
            status: 'scheduled',
            notes: 'Applied from suggested schedule',
          },
        });

        result.accepted.push({
          shiftId: pair.shiftId,
          employeeId: pair.employeeId,
          blocking: [],
          warnings: validation.warnings,
        });
      }
    });

    // Auditability: record the apply action (interactive optimization path) so the
    // outcome of a bulk apply is always traceable to the requesting user.
    await this.prisma.optimizationRequest.create({
      data: {
        companyId,
        requestedById: userId,
        parameters: JSON.parse(JSON.stringify(dto)),
        status: 'completed',
        path: 'interactive',
        idempotencyKey: randomUUID(),
        resultJson: JSON.parse(JSON.stringify(result)),
        completedAt: new Date(),
      },
    });

    return result;
  }

  /**
   * Build the deterministic availability map used to constrain the optimizer.
   * A shift is offered to an employee only when it introduces no BLOCKING conflict
   * and does not violate the minimum rest period against an existing assignment.
   */
  private buildAvailability(
    shifts: Array<{
      id: string;
      startAt: Date;
      endAt: Date;
      status: string;
    }>,
    employees: Array<{ id: string; status: string }>,
    approvedLeaves: Array<{
      employeeId: string;
      startDate: Date;
      endDate: Date;
      status: string;
    }>,
    existingAssignments: Array<{
      shiftId: string;
      employeeId: string;
      status: string;
    }>,
  ): Map<string, string[]> {
    const map = new Map<string, string[]>();

    for (const employee of employees) {
      if (employee.status !== 'active') continue;
      const employeeAssignments = existingAssignments.filter((a) => a.employeeId === employee.id);
      const assignedShiftIds = new Set(employeeAssignments.map((a) => a.shiftId));

      const available: string[] = [];
      for (const shift of shifts) {
        if (shift.status === 'cancelled') continue;
        if (assignedShiftIds.has(shift.id)) continue;

        const onLeave = approvedLeaves.some(
          (l) =>
            l.employeeId === employee.id &&
            l.startDate <= shift.endAt &&
            l.endDate >= shift.startAt,
        );
        if (onLeave) continue;

        const overlapsExisting = employeeAssignments.some((a) => {
          const ex = shifts.find((s) => s.id === a.shiftId);
          return ex && ex.startAt < shift.endAt && ex.endAt > shift.startAt;
        });
        if (overlapsExisting) continue;

        const violatesMinRest = employeeAssignments.some((a) => {
          const ex = shifts.find((s) => s.id === a.shiftId);
          if (!ex) return false;
          const gapHours =
            shift.startAt >= ex.endAt
              ? (shift.startAt.getTime() - ex.endAt.getTime()) / 3_600_000
              : (ex.startAt.getTime() - shift.endAt.getTime()) / 3_600_000;
          return gapHours < MIN_REST_HOURS;
        });
        if (violatesMinRest) continue;

        available.push(shift.id);
      }
      map.set(employee.id, available);
    }

    return map;
  }
}
