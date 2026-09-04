import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AssignShiftDto,
  CreateScheduleDto,
  CreateShiftDto,
  OptimizeApplyDto,
  OptimizeScheduleDto,
  OpenShiftRequestDto,
  OpenShiftReviewDto,
  ShiftConflictOverrideDto,
  SwapRequestDto,
  SwapRespondDto,
  SwapReviewDto,
} from '@sms/shared';
import type { ScheduleExplanation } from '@sms/shared';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { OptimizerClient } from '../../infrastructure/optimizer/optimizer.client';
import { ScopeFilterService } from '../authorization/scope-filter.service';
import { NotificationsService } from '../notifications/notifications.service';

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
  explanation?: ScheduleExplanation;
}

const MIN_REST_HOURS = 11;

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** Clock time (minutes since midnight) of a Date, using local wall-clock components. */
function toClockMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Parse an 'HH:mm' availability window bound into minutes since midnight. */
function to24hMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => Number(n));
  return (h || 0) * 60 + (m || 0);
}

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeFilter: ScopeFilterService,
    private readonly optimizer: OptimizerClient,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(
    companyId: string,
    filters: {
      branchId?: string;
      departmentId?: string;
      scheduleId?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
      isOpen?: boolean;
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
    if (filters.scheduleId) where.scheduleId = filters.scheduleId;
    if (filters.status) where.status = filters.status;
    if (typeof filters.isOpen === 'boolean') where.isOpen = filters.isOpen;
    if (filters.startDate || filters.endDate) {
      where.startAt = {};
      if (filters.startDate) where.startAt.gte = new Date(filters.startDate);
      if (filters.endDate) where.startAt.lte = new Date(filters.endDate);
    }

    const shifts = await this.prisma.shift.findMany({
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

    // Attach staffing coverage (required vs filled headcount) for display in the
    // schedule UI (under/over-staffed indicators).
    return shifts.map((s) => {
      const headcountRequired = s.requirements.reduce((sum, r) => sum + r.headcount, 0);
      const headcountFilled = s.assignments.filter(
        (a) => a.status !== 'cancelled' && a.status !== 'dropped',
      ).length;
      const shortfall = Math.max(0, headcountRequired - headcountFilled);
      return {
        ...s,
        coverage: {
          shiftId: s.id,
          headcountRequired,
          headcountFilled,
          shortfall,
          covered: shortfall === 0,
          overstaffed: headcountFilled > headcountRequired,
        },
      };
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

  /**
   * Replace a shift's coverage requirements (headcount, skills, certifications)
   * transactionally. Existing requirement rows and their joins cascade away;
   * the resulting shift detail is re-validated against nothing — assignments
   * are left untouched, but the new requirements drive future coverage and
   * eligibility checks.
   */
  async setShiftRequirements(companyId: string, shiftId: string, dto: { requirements?: Array<{
    headcount: number;
    positionId?: string;
    branchConstraint?: string;
    skillIds?: string[];
    certificationIds?: string[];
  }> }, userId: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, companyId },
      select: { id: true, name: true },
    });
    if (!shift) {
      throw new NotFoundException(`Shift with ID ${shiftId} not found`);
    }

    const requirements = dto.requirements ?? [];
    await this.prisma.$transaction(async (tx) => {
      await tx.shiftRequirement.deleteMany({ where: { shiftId } });

      for (const req of requirements) {
        const requirement = await tx.shiftRequirement.create({
          data: {
            shiftId,
            headcount: req.headcount,
            positionId: req.positionId,
            branchConstraint: req.branchConstraint,
          },
        });

        if (req.skillIds && req.skillIds.length > 0) {
          await tx.shiftRequirementSkill.createMany({
            data: req.skillIds.map((skillId) => ({ requirementId: requirement.id, skillId })),
            skipDuplicates: true,
          });
        }

        if (req.certificationIds && req.certificationIds.length > 0) {
          await tx.shiftRequirementCertification.createMany({
            data: req.certificationIds.map((certificationId) => ({
              requirementId: requirement.id,
              certificationId,
            })),
            skipDuplicates: true,
          });
        }
      }

      await tx.shiftHistory.create({
        data: {
          shiftId,
          changedById: userId,
          changeType: 'requirements_updated',
          after: { requirements: requirements.length },
        },
      });
    });

    return this.findById(companyId, shiftId);
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
        skills: { include: { skill: true } },
        certifications: { include: { certification: true } },
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

    // 3b. Qualifications (required skills + certifications) (BLOCKING, ADR hard rule)
    // An employee cannot be assigned to a shift that requires a skill they do not
    // hold, a certification they do not hold, or a certification that is expired
    // on the shift date. Required catalog entries that have been archived (marked
    // inactive) are treated as blocking for everyone — the shift requirement must
    // be revised before anyone can staff it.
    const heldSkills = new Set(
      employee.skills
        .filter((s) => s.skill?.isActive !== false)
        .map((s) => s.skillId),
    );
    for (const req of shift.requirements ?? []) {
      const requiredSkillIds = (req.skills ?? []).map((s) => s.skillId);
      const requiredCertIds = (req.certifications ?? []).map((c) => c.certificationId);

      for (const skillId of requiredSkillIds) {
        if (!heldSkills.has(skillId)) {
          const name = (req.skills ?? []).find((s) => s.skillId === skillId)?.skill?.name ?? skillId;
          conflicts.push({
            type: 'MISSING_SKILL',
            severity: 'BLOCKING',
            employeeId,
            shiftId,
            ruleIdentifier: 'QUALIFICATIONS',
            message: `Employee does not hold required skill '${name}'`,
            overrideAllowed: false,
            metadata: { skillId, headcount: req.headcount },
          });
        }
      }

      for (const certId of requiredCertIds) {
        const assignment = employee.certifications.find((c) => c.certificationId === certId);
        const name =
          (req.certifications ?? []).find((c) => c.certificationId === certId)?.certification?.name ??
          certId;
        if (!assignment) {
          conflicts.push({
            type: 'MISSING_CERTIFICATION',
            severity: 'BLOCKING',
            employeeId,
            shiftId,
            ruleIdentifier: 'QUALIFICATIONS',
            message: `Employee does not hold required certification '${name}'`,
            overrideAllowed: false,
            metadata: { certificationId: certId, headcount: req.headcount },
          });
        } else if (assignment.certification?.isActive === false) {
          conflicts.push({
            type: 'EXPIRED_CERTIFICATION',
            severity: 'BLOCKING',
            employeeId,
            shiftId,
            ruleIdentifier: 'QUALIFICATIONS',
            message: `Required certification '${name}' is inactive/archived`,
            overrideAllowed: false,
            metadata: { certificationId: certId, headcount: req.headcount },
          });
        } else if (!this.isCertValidOn(assignment, shift.endAt)) {
          conflicts.push({
            type: 'EXPIRED_CERTIFICATION',
            severity: 'BLOCKING',
            employeeId,
            shiftId,
            ruleIdentifier: 'QUALIFICATIONS',
            message: `Required certification '${name}' has expired before ${shift.endAt.toISOString().slice(0, 10)}`,
            overrideAllowed: false,
            metadata: { certificationId: certId, expiresAt: assignment.expiresAt, headcount: req.headcount },
          });
        }
      }
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

    // 4b. Check recurring availability rules (day-of-week + time window) (WARNING)
    const dayOfWeek = shiftDate.getDay();
    const shiftStartClock = toClockMinutes(shift.startAt);
    const shiftEndClock = toClockMinutes(shift.endAt);
    const applicableRule = employee.availabilityRules.find(
      (r) =>
        r.dayOfWeek === dayOfWeek &&
        (!r.effectiveFrom || shiftDate >= r.effectiveFrom) &&
        (!r.effectiveTo || shiftDate <= r.effectiveTo),
    );

    if (applicableRule) {
      const ruleAvailable = to24hMinutes(applicableRule.startTime) <= shiftStartClock
        && to24hMinutes(applicableRule.endTime) >= shiftEndClock;
      if (!applicableRule.isAvailable) {
        warnings.push({
          type: 'AVAILABILITY_RULE',
          severity: 'WARNING',
          employeeId,
          shiftId,
          ruleIdentifier: 'AVAILABILITY_RULE',
          message: `Employee is not available on ${WEEKDAY_NAMES[dayOfWeek]} per their availability rules`,
          overrideAllowed: true,
        });
      } else if (!ruleAvailable) {
        warnings.push({
          type: 'AVAILABILITY_RULE_WINDOW',
          severity: 'WARNING',
          employeeId,
          shiftId,
          ruleIdentifier: 'AVAILABILITY_RULE',
          message: `Shift falls outside the employee's ${WEEKDAY_NAMES[dayOfWeek]} availability window (${applicableRule.startTime}-${applicableRule.endTime})`,
          overrideAllowed: true,
        });
      }
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

    const assignment = await this.prisma.shiftAssignment.create({
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

    await this.notifyAssignmentUsers(companyId, [{ shiftId, employeeId: dto.employeeId }], 'shift.assigned');

    return assignment;
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

    // ADR hard rule: qualification conflicts are never overridable, even through
    // the explicit override endpoint — the override is for warnings only
    // (availability/min-rest), never for missing skills/certifications.
    if (dto.ruleIdentifier === 'QUALIFICATIONS') {
      throw new BadRequestException(
        'Qualification conflicts (missing/expired skills or certifications) cannot be overridden',
      );
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

    const publishResult = await this.prisma.$transaction(async (tx) => {
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

      return {
        success: true,
        versionNumber: nextVersionNumber,
        publishedAt: new Date().toISOString(),
      };
    });

    // In-app notification: employees with an assignment in this schedule.
    const notified: Array<{ shiftId: string; employeeId: string }> = [];
    for (const s of schedule.shifts) {
      for (const a of s.assignments ?? []) {
        if (a.status === 'cancelled' || a.status === 'dropped') continue;
        notified.push({ shiftId: s.id, employeeId: a.employeeId });
      }
    }
    await this.notifyAssignmentUsers(companyId, notified, 'schedule.published');

    return publishResult;
  }

  async createSchedule(companyId: string, dto: CreateScheduleDto, userId: string) {
    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, companyId },
        select: { id: true },
      });
      if (!branch) {
        throw new NotFoundException('branch does not belong to this company');
      }
    }

    if (new Date(dto.periodEnd) < new Date(dto.periodStart)) {
      throw new BadRequestException('periodEnd must be on or after periodStart');
    }

    return this.prisma.schedule.create({
      data: {
        companyId,
        branchId: dto.branchId,
        name: dto.name,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        status: 'draft',
        createdById: userId,
      },
    });
  }

  /**
   * List schedules for the company, restricted to the caller's granted scope
   * (ADT-003). Optionally filtered by branch / date window.
   */
  async findSchedules(
    companyId: string,
    filters: { branchId?: string; startDate?: string; endDate?: string },
    membershipId: string,
  ) {
    const where: Record<string, any> = { companyId };
    const scopeWhere = await this.scopeFilter.branchWhere(membershipId, companyId);
    if (filters.branchId) {
      where.branchId = filters.branchId;
    } else if (scopeWhere) {
      // A caller without company-wide scope only sees schedules for their branches.
      where.branchId = { in: [] };
    }

    if (filters.startDate || filters.endDate) {
      where.OR = [];
      if (filters.startDate) {
        where.OR.push({ periodEnd: { gte: new Date(filters.startDate) } });
      }
      if (filters.endDate) {
        where.OR.push({ periodStart: { lte: new Date(filters.endDate) } });
      }
      if (where.OR.length === 0) delete where.OR;
    }

    const schedules = await this.prisma.schedule.findMany({
      where,
      orderBy: { periodStart: 'asc' },
      include: {
        branch: true,
        _count: { select: { shifts: true, versions: true } },
      },
    });

    return schedules;
  }

  /**
   * Version history for a schedule (immutable snapshots, newest first). Returned
   * snapshots are trimmed to light metadata; the full snapshot is retrievable via
   * the version detail endpoint.
   */
  async findScheduleVersions(companyId: string, scheduleId: string, membershipId: string) {
    const schedule = await this.prisma.schedule.findFirst({
      where: {
        id: scheduleId,
        companyId,
        ...(await this.branchScopeWhere(membershipId, companyId)),
      },
      select: { id: true },
    });
    if (!schedule) {
      throw new NotFoundException(`Schedule with ID ${scheduleId} not found`);
    }

    return this.prisma.scheduleVersion.findMany({
      where: { scheduleId },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        scheduleId: true,
        versionNumber: true,
        publishedAt: true,
        notes: true,
        publishedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /**
   * Compute staffing coverage for a set of shifts: required vs. filled headcount
   * per shift (summing all requirement headcounts), so callers can flag
   * under/over-staffed shifts. Assignment counts exclude cancelled/dropped.
   */
  async coverage(companyId: string, shiftIds: string[], membershipId: string) {
    const where: Record<string, any> = {
      id: { in: shiftIds },
      companyId,
    };
    const queryScope = await this.scopeFilter.shiftQueryScope(membershipId, companyId);
    if (queryScope.shiftWhere) {
      where.AND = [queryScope.shiftWhere];
    }

    const shifts = await this.prisma.shift.findMany({
      where,
      include: {
        requirements: true,
        assignments: { where: { status: { notIn: ['cancelled', 'dropped'] } } },
      },
    });

    return shifts.map((s) => {
      const headcountRequired = s.requirements.reduce((sum, r) => sum + r.headcount, 0);
      const headcountFilled = s.assignments.length;
      const shortfall = Math.max(0, headcountRequired - headcountFilled);
      return {
        shiftId: s.id,
        headcountRequired,
        headcountFilled,
        shortfall,
        covered: shortfall === 0,
        overstaffed: headcountFilled > headcountRequired,
      };
    });
  }

  private async branchScopeWhere(membershipId: string, companyId: string): Promise<Record<string, any>> {
    const scopeWhere = await this.scopeFilter.branchWhere(membershipId, companyId);
    // branchWhere returns the branch-scoped predicate; for schedule filtering we
    // only allow company-wide callers to see all schedules. Employees with a
    // non-company scope are handled by the controller read path when relevant.
    return scopeWhere ? { branchId: { in: [] } } : {};
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
      include: {
        requirements: {
          include: { skills: { include: { skill: true } }, certifications: { include: { certification: true } } },
        },
      },
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
      include: {
        skills: { include: { skill: true } },
        certifications: { include: { certification: true } },
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

    const availability = await this.buildAvailability(
      shifts,
      employees,
      approvedLeaves,
      existingAssignments,
      windowEnd,
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
        required_skills: s.requirements.flatMap((r) => (r.skills ?? []).map((x) => x.skillId)),
        required_certifications: s.requirements.flatMap((r) => (r.certifications ?? []).map((x) => x.certificationId)),
      })),
      employees: employees.map((e) => ({
        employee_id: e.id,
        available_shift_ids: availability.map.get(e.id) ?? [],
        max_hours_per_week: 40,
        min_hours_per_week: 0,
        skills: (e.skills ?? []).filter((s) => s.skill?.isActive !== false).map((s) => s.skillId),
        certifications: (e.certifications ?? [])
          .filter(
            (c) =>
              c.certification?.isActive !== false &&
              this.isCertValidOn(c, windowEnd),
          )
          .map((c) => c.certificationId),
      })),
      max_solver_time_seconds: 30,
      min_rest_hours: MIN_REST_HOURS,
    };

    const optimizerResult = await this.optimizer.optimize(request);

    // Revalidate every proposed pair against the authoritative engine; block unsafe ones.
    const assignments: SuggestionAssignment[] = [];
    let droppedBlocking = 0;
    const droppedReasons = new Map<string, number>();
    for (const a of optimizerResult.assignments) {
      const validation = await this.validateAssignment(companyId, a.shift_id, a.employee_id);
      const blocking = validation.conflicts;
      if (blocking.length > 0) {
        droppedBlocking += 1;
        for (const c of blocking) {
          droppedReasons.set(c.type, (droppedReasons.get(c.type) ?? 0) + 1);
        }
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

    const explanation = this.buildExplanation(
      shifts,
      employees,
      availability,
      assignments,
      droppedReasons,
    );

    const suggestion: ScheduleSuggestion = {
      status: optimizerResult.status,
      shiftsConsidered: shifts.length,
      suggestedCount: assignments.length,
      unfilledShifts,
      droppedBlocking,
      solverTimeSeconds: optimizerResult.solver_time_seconds,
      objectiveValue: optimizerResult.objective_value,
      assignments,
      explanation,
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

    // In-app notifications for every newly accepted assignment.
    await this.notifyAssignmentUsers(companyId, result.accepted, 'shift.assigned');

    return result;
  }

  /**
   * Build the deterministic availability map used to constrain the optimizer.
   * A shift is offered to an employee only when it introduces no BLOCKING conflict,
   * does not violate the minimum rest period against an existing assignment, and
   * the employee holds every required skill/certification for the shift.
   *
   * Exclusion reasons are tracked per employee (distinct reasons) so the schedule
   * explanation can truthfully say who was excluded and why — never fabricated.
   */
  private async buildAvailability(
    shifts: Array<{
      id: string;
      startAt: Date;
      endAt: Date;
      status: string;
      requirements?: Array<{
        headcount: number;
        skills?: Array<{ skillId: string; skill?: { name: string; isActive: boolean } | null }>;
        certifications?: Array<{
          certificationId: string;
          certification?: { name: string; isActive: boolean } | null;
        }>;
      }>;
    }>,
    employees: Array<{
      id: string;
      status: string;
      skills?: Array<{ skillId: string; skill?: { isActive: boolean } | null }>;
      certifications?: Array<{
        certificationId: string;
        expiresAt: Date | null;
        certification?: { isActive: boolean } | null;
      }>;
    }>,
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
    windowEnd: Date,
  ): Promise<{ map: Map<string, string[]>; exclusions: Map<string, Set<string>> }> {
    const map = new Map<string, string[]>();
    const exclusions = new Map<string, Set<string>>();

    for (const employee of employees) {
      if (employee.status !== 'active') continue;
      const employeeAssignments = existingAssignments.filter((a) => a.employeeId === employee.id);
      const assignedShiftIds = new Set(employeeAssignments.map((a) => a.shiftId));

      const available: string[] = [];
      for (const shift of shifts) {
        if (shift.status === 'cancelled') continue;
        if (assignedShiftIds.has(shift.id)) continue;

        const failures: string[] = [];

        const onLeave = approvedLeaves.some(
          (l) =>
            l.employeeId === employee.id &&
            l.startDate <= shift.endAt &&
            l.endDate >= shift.startAt,
        );
        if (onLeave) failures.push('APPROVED_LEAVE');

        const overlapsExisting = employeeAssignments.some((a) => {
          const ex = shifts.find((s) => s.id === a.shiftId);
          return ex && ex.startAt < shift.endAt && ex.endAt > shift.startAt;
        });
        if (!onLeave && overlapsExisting) failures.push('SHIFT_OVERLAP');

        const violatesMinRest = !onLeave && !overlapsExisting && employeeAssignments.some((a) => {
          const ex = shifts.find((s) => s.id === a.shiftId);
          if (!ex) return false;
          const gapHours =
            shift.startAt >= ex.endAt
              ? (shift.startAt.getTime() - ex.endAt.getTime()) / 3_600_000
              : (ex.startAt.getTime() - shift.endAt.getTime()) / 3_600_000;
          return gapHours < MIN_REST_HOURS;
        });
        if (violatesMinRest) failures.push('MIN_REST');

        failures.push(...this.qualificationFailures(employee, shift, windowEnd));

        if (failures.length > 0) {
          const set = exclusions.get(employee.id) ?? new Set<string>();
          for (const f of failures) set.add(f);
          exclusions.set(employee.id, set);
          continue;
        }

        available.push(shift.id);
      }
      map.set(employee.id, available);
    }

    return { map, exclusions };
  }

  /**
   * Qualification gate shared with buildAvailability: returns the exclusion
   * reason codes (MISSING_SKILL / MISSING_CERTIFICATION / EXPIRED_CERTIFICATION)
   * that apply for an employee against a shift.
   */
  private qualificationFailures(
    employee: {
      skills?: Array<{ skillId: string; skill?: { isActive: boolean } | null }>;
      certifications?: Array<{
        certificationId: string;
        expiresAt: Date | null;
        certification?: { isActive: boolean } | null;
      }>;
    },
    shift: {
      requirements?: Array<{
        skills?: Array<{ skillId: string }>;
        certifications?: Array<{ certificationId: string }>;
      }>;
    },
    windowEnd: Date,
  ): string[] {
    const failures: string[] = [];
    const heldSkills = new Set(
      (employee.skills ?? [])
        .filter((s) => s.skill?.isActive !== false)
        .map((s) => s.skillId),
    );
    const heldCerts = new Set(
      (employee.certifications ?? [])
        .filter(
          (c) =>
            c.certification?.isActive !== false && this.isCertValidOn(c, windowEnd),
        )
        .map((c) => c.certificationId),
    );

    for (const req of shift.requirements ?? []) {
      for (const sid of (req.skills ?? []).map((s) => s.skillId)) {
        if (!heldSkills.has(sid)) {
          failures.push('MISSING_SKILL');
          break;
        }
      }
      for (const cid of (req.certifications ?? []).map((c) => c.certificationId)) {
        if (!heldCerts.has(cid)) {
          const assignment = (employee.certifications ?? []).find((c) => c.certificationId === cid);
          failures.push(assignment && assignment.expiresAt ? 'EXPIRED_CERTIFICATION' : 'MISSING_CERTIFICATION');
          break;
        }
      }
    }
    return failures;
  }

  /** A certification is valid on `reference` when it has no expiration or expires after it. */
  private isCertValidOn(
    assignment: { expiresAt: Date | null },
    reference: Date,
  ): boolean {
    if (!assignment.expiresAt) return true;
    return assignment.expiresAt > reference;
  }

  /**
   * Derive the schedule explanation strictly from data the API produced while
   * building availability and revalidating proposals (never fabricated).
   */
  private buildExplanation(
    shifts: Array<{ id: string; requirements: Array<{ headcount: number }> }>,
    employees: Array<{ id: string; status: string }>,
    availability: {
      map: Map<string, string[]>;
      exclusions: Map<string, Set<string>>;
    },
    assignments: Array<{ shiftId: string; employeeId: string }>,
    droppedReasons: Map<string, number>,
  ): ScheduleExplanation {
    const considered = employees.filter((e) => e.status === 'active');

    const excluded = considered.filter((e) => {
      const offered = (availability.map.get(e.id) ?? []).length;
      return offered === 0 || (availability.exclusions.get(e.id)?.size ?? 0) > 0;
    });

    const reasonCounts = new Map<string, number>();
    for (const e of considered) {
      for (const r of availability.exclusions.get(e.id) ?? []) {
        reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
      }
    }
    for (const [r, c] of droppedReasons) {
      reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + c);
    }

    const requiredById = new Map(
      shifts.map((s) => [
        s.id,
        s.requirements.length > 0
          ? s.requirements.reduce((sum, r) => sum + r.headcount, 0)
          : 1,
      ]),
    );
    const assignedCount = new Map<string, number>();
    for (const a of assignments) {
      assignedCount.set(a.shiftId, (assignedCount.get(a.shiftId) ?? 0) + 1);
    }

    let fullyCovered = 0;
    let partiallyCovered = 0;
    let unfilled = 0;
    let noEligible = 0;
    for (const s of shifts) {
      const required = requiredById.get(s.id) ?? 1;
      const got = assignedCount.get(s.id) ?? 0;
      if (got >= required) fullyCovered += 1;
      else if (got > 0) partiallyCovered += 1;
      else {
        unfilled += 1;
        let candidates = 0;
        for (const ids of availability.map.values()) {
          if (ids.includes(s.id)) candidates += 1;
        }
        if (candidates === 0) noEligible += 1;
      }
    }
    if (noEligible > 0) {
      reasonCounts.set('NO_ELIGIBLE_EMPLOYEE', (reasonCounts.get('NO_ELIGIBLE_EMPLOYEE') ?? 0) + noEligible);
    }

    const exclusionReasons = [...reasonCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .map((r) => ({
        code: r.code as ScheduleExplanation['exclusionReasons'][number]['code'],
        count: r.count,
      }));

    return {
      employeesConsidered: considered.length,
      employeesExcluded: excluded.length,
      proposedAssignments: assignments.length,
      fullyCoveredShifts: fullyCovered,
      partiallyCoveredShifts: partiallyCovered,
      unfilledShifts: unfilled,
      exclusionReasons,
    };
  }

  // ---- Open shifts (P6) ----

  private async resolveEmployeeIdForUser(companyId: string, userId: string): Promise<string> {
    const employee = await this.prisma.employee.findFirst({
      where: { companyId, userId },
      select: { id: true },
    });
    if (!employee) {
      throw new BadRequestException('No employee profile is linked to this account');
    }
    return employee.id;
  }

  async setShiftOpen(companyId: string, shiftId: string, isOpen: boolean, userId: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, companyId },
      include: {
        requirements: {
          include: { skills: { include: { skill: true } }, certifications: { include: { certification: true } } },
        },
      },
    });
    if (!shift) {
      throw new NotFoundException(`Shift with ID ${shiftId} not found`);
    }

    if (isOpen === shift.isOpen) {
      return { shiftId, isOpen: shift.isOpen, notifiedEmployees: 0 };
    }

    await this.prisma.shift.update({ where: { id: shiftId }, data: { isOpen } });
    await this.prisma.shiftHistory.create({
      data: {
        shiftId,
        changedById: userId,
        changeType: isOpen ? 'shift_opened' : 'shift_closed',
        after: { isOpen },
      },
    });

    let notified = 0;
    if (isOpen) {
      const employees = await this.prisma.employee.findMany({
        where: { companyId, status: 'active', branchId: shift.branchId },
        include: {
          skills: { include: { skill: true } },
          certifications: { include: { certification: true } },
        },
      });
      const [approvedLeaves, existingAssignments] = await Promise.all([
        employees.length
          ? this.prisma.leaveRequest.findMany({
              where: {
                companyId,
                status: 'approved',
                employeeId: { in: employees.map((e) => e.id) },
                startDate: { lte: shift.endAt },
                endDate: { gte: shift.startAt },
              },
            })
          : Promise.resolve([]),
        this.prisma.shiftAssignment.findMany({
          where: { shiftId, status: { not: 'cancelled' } },
        }),
      ]);

      const { map } = await this.buildAvailability(
        [shift],
        employees,
        approvedLeaves,
        existingAssignments,
        shift.endAt,
      );
      const eligible = employees.filter((e) => (map.get(e.id) ?? []).includes(shift.id));
      await this.notifyAssignmentUsers(
        companyId,
        eligible.map((e) => ({ shiftId, employeeId: e.id })),
        'open_shift.available',
      );
      notified = eligible.length;
    }

    return { shiftId, isOpen, notifiedEmployees: notified };
  }

  async requestOpenShift(companyId: string, dto: OpenShiftRequestDto, userId: string) {
    const employeeId = await this.resolveEmployeeIdForUser(companyId, userId);
    const shift = await this.prisma.shift.findFirst({
      where: { id: dto.shiftId, companyId, isOpen: true },
      select: { id: true, name: true },
    });
    if (!shift) {
      throw new NotFoundException('This shift is not open for requests');
    }

    const existingAssignment = await this.prisma.shiftAssignment.findFirst({
      where: { shiftId: dto.shiftId, employeeId, status: { not: 'cancelled' } },
    });
    if (existingAssignment) {
      throw new ConflictException('You are already assigned to this shift');
    }
    const duplicate = await this.prisma.openShiftRequest.findFirst({
      where: { shiftId: dto.shiftId, employeeId, status: 'pending' },
    });
    if (duplicate) {
      throw new ConflictException('You already have a pending request for this shift');
    }

    const validation = await this.validateAssignment(companyId, dto.shiftId, employeeId);
    if (!validation.isValid) {
      throw new BadRequestException(
        validation.conflicts.map((c) => c.message).join('; ') || 'You do not qualify for this shift',
      );
    }

    const request = await this.prisma.openShiftRequest.create({
      data: { companyId, shiftId: dto.shiftId, employeeId },
    });

    await this.notifyUser({
      companyId,
      userId,
      eventType: 'open_shift.requested',
      title: 'Open shift requested',
      body: `Request submitted for shift '${shift.name}'`,
      relatedEntityType: 'open_shift_request',
      relatedEntityId: request.id,
    });

    return request;
  }

  async reviewOpenShiftRequest(
    companyId: string,
    requestId: string,
    dto: OpenShiftReviewDto,
    reviewerUserId: string,
  ) {
    const request = await this.prisma.openShiftRequest.findFirst({
      where: { id: requestId, companyId },
      include: {
        employee: {
          select: { id: true, userId: true, firstName: true, lastName: true },
        },
        shift: { select: { id: true, name: true } },
      },
    });
    if (!request) {
      throw new NotFoundException(`Open shift request ${requestId} not found`);
    }
    if (request.status !== 'pending') {
      throw new ConflictException('This request has already been resolved');
    }

    if (dto.action === 'reject') {
      const updated = await this.prisma.openShiftRequest.update({
        where: { id: requestId },
        data: { status: 'rejected', resolvedById: reviewerUserId, resolvedAt: new Date() },
      });
      if (request.employee.userId) {
        await this.notifyUser({
          companyId,
          userId: request.employee.userId,
          eventType: 'open_shift.rejected',
          title: 'Open shift request declined',
          body: `Your request for shift '${request.shift.name}' was declined`,
          relatedEntityType: 'shift',
          relatedEntityId: request.shift.id,
        });
      }
      return updated;
    }

    const validation = await this.validateAssignment(companyId, request.shiftId, request.employee.id);
    if (!validation.isValid) {
      throw new BadRequestException(
        'Cannot approve: the employee no longer qualifies for this shift',
      );
    }
    const already = await this.prisma.shiftAssignment.findFirst({
      where: { shiftId: request.shiftId, employeeId: request.employee.id, status: { not: 'cancelled' } },
    });
    if (already) {
      throw new ConflictException('The employee is already assigned to this shift');
    }

    const assignment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shiftAssignment.create({
        data: {
          shiftId: request.shiftId,
          employeeId: request.employee.id,
          status: 'scheduled',
          notes: 'Via open shift request',
        },
      });
      await tx.openShiftRequest.update({
        where: { id: requestId },
        data: { status: 'approved', resolvedById: reviewerUserId, resolvedAt: new Date() },
      });
      await tx.shiftHistory.create({
        data: {
          shiftId: request.shiftId,
          changedById: reviewerUserId,
          changeType: 'open_shift_approved',
          after: { assignmentId: created.id },
        },
      });
      return created;
    });

    if (request.employee.userId) {
      await this.notifyUser({
        companyId,
        userId: request.employee.userId,
        eventType: 'open_shift.approved',
        title: 'Open shift approved',
        body: `Your request for shift '${request.shift.name}' was approved`,
        relatedEntityType: 'shift',
        relatedEntityId: request.shift.id,
      });
    }

    return assignment;
  }

  async listOpenShiftRequests(companyId: string) {
    return this.prisma.openShiftRequest.findMany({
      where: { companyId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, email: true } },
        shift: { select: { id: true, name: true, startAt: true, endAt: true, branchId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---- Shift swaps (P7) ----

  async requestSwap(companyId: string, dto: SwapRequestDto, userId: string) {
    const employeeId = await this.resolveEmployeeIdForUser(companyId, userId);
    const [shift, requester] = await Promise.all([
      this.prisma.shift.findFirst({
        where: { id: dto.shiftId, companyId },
        select: { id: true, name: true },
      }),
      this.prisma.employee.findFirst({
        where: { id: employeeId, companyId },
        select: { firstName: true, lastName: true },
      }),
    ]);
    if (!shift) {
      throw new NotFoundException(`Shift with ID ${dto.shiftId} not found`);
    }

    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: { shiftId: dto.shiftId, employeeId, status: { notIn: ['cancelled', 'dropped', 'swapped'] } },
    });
    if (!assignment) {
      throw new BadRequestException('You are not assigned to this shift');
    }
    const duplicate = await this.prisma.shiftSwapRequest.findFirst({
      where: { shiftId: dto.shiftId, requestingEmployeeId: employeeId, status: 'pending' },
    });
    if (duplicate) {
      throw new ConflictException('You already have a pending swap request for this shift');
    }

    const created = await this.prisma.shiftSwapRequest.create({
      data: {
        companyId,
        shiftId: dto.shiftId,
        requestingEmployeeId: employeeId,
        targetEmployeeId: dto.targetEmployeeId,
        reason: dto.reason,
      },
    });

    if (dto.targetEmployeeId) {
      const target = await this.prisma.employee.findFirst({
        where: { id: dto.targetEmployeeId, companyId },
        select: { userId: true },
      });
      if (target?.userId) {
        await this.notifyUser({
          companyId,
          userId: target.userId,
          eventType: 'swap.requested',
          title: 'Shift swap requested',
          body: `${requester?.firstName ?? 'A colleague'} ${requester?.lastName ?? ''} asked you to take shift '${shift.name}'`.replace('  ', ' '),
          relatedEntityType: 'swap_request',
          relatedEntityId: created.id,
        });
      }
    }

    return created;
  }

  async respondSwap(companyId: string, requestId: string, dto: SwapRespondDto, userId: string) {
    const employeeId = await this.resolveEmployeeIdForUser(companyId, userId);
    const request = await this.prisma.shiftSwapRequest.findFirst({
      where: { id: requestId, companyId },
      include: {
        requestingEmployee: { select: { userId: true, firstName: true, lastName: true } },
        shift: { select: { id: true, name: true } },
      },
    });
    if (!request) {
      throw new NotFoundException(`Swap request ${requestId} not found`);
    }
    if (request.status !== 'pending') {
      throw new ConflictException('This swap request is no longer pending');
    }
    if (request.requestingEmployeeId === employeeId) {
      throw new BadRequestException('You cannot respond to your own swap request');
    }
    if (request.targetEmployeeId && request.targetEmployeeId !== employeeId) {
      throw new BadRequestException('This swap request was directed at another employee');
    }

    const status = dto.action === 'accept' ? 'accepted' : 'rejected';
    const updated = await this.prisma.shiftSwapRequest.update({
      where: { id: requestId },
      data: {
        status,
        targetEmployeeId: request.targetEmployeeId ?? employeeId,
      },
    });

    if (request.requestingEmployee.userId) {
      await this.notifyUser({
        companyId,
        userId: request.requestingEmployee.userId,
        eventType: dto.action === 'accept' ? 'swap.accepted' : 'swap.rejected',
        title: dto.action === 'accept' ? 'Swap request accepted' : 'Swap request declined',
        body:
          dto.action === 'accept'
            ? `Your swap request for '${request.shift.name}' was accepted`
            : `Your swap request for '${request.shift.name}' was declined`,
        relatedEntityType: 'swap_request',
        relatedEntityId: requestId,
      });
    }

    return updated;
  }

  async reviewSwap(companyId: string, requestId: string, dto: SwapReviewDto, reviewerUserId: string) {
    const request = await this.prisma.shiftSwapRequest.findFirst({
      where: { id: requestId, companyId },
      include: {
        requestingEmployee: { select: { id: true, userId: true, firstName: true, lastName: true } },
        targetEmployee: { select: { id: true, userId: true, firstName: true, lastName: true } },
        shift: { select: { id: true, name: true } },
      },
    });
    if (!request) {
      throw new NotFoundException(`Swap request ${requestId} not found`);
    }
    if (request.status !== 'accepted') {
      throw new ConflictException('Only accepted swap requests can be reviewed');
    }
    if (!request.targetEmployeeId) {
      throw new BadRequestException('This swap has no target employee to take the shift');
    }

    if (dto.action === 'reject') {
      const updated = await this.prisma.shiftSwapRequest.update({
        where: { id: requestId },
        data: { status: 'rejected', resolvedById: reviewerUserId, resolvedAt: new Date() },
      });
      for (const target of [request.requestingEmployee, request.targetEmployee]) {
        if (target?.userId) {
          await this.notifyUser({
            companyId,
            userId: target.userId,
            eventType: 'swap.rejected',
            title: 'Swap rejected by manager',
            body: `The swap for shift '${request.shift.name}' was not approved`,
            relatedEntityType: 'swap_request',
            relatedEntityId: requestId,
          });
        }
      }
      return updated;
    }

    const target = request.targetEmployee as { id: string; userId: string | null };
    const validation = await this.validateAssignment(companyId, request.shift.id, target.id);
    if (!validation.isValid) {
      throw new BadRequestException(
        validation.conflicts.map((c) => c.message).join('; ') || 'The target employee does not qualify for this shift',
      );
    }
    const already = await this.prisma.shiftAssignment.findFirst({
      where: { shiftId: request.shift.id, employeeId: target.id, status: { not: 'cancelled' } },
    });
    if (already) {
      throw new ConflictException('The target employee is already assigned to this shift');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const [newAssignment] = await Promise.all([
        tx.shiftAssignment.create({
          data: {
            shiftId: request.shift.id,
            employeeId: target.id,
            status: 'scheduled',
            notes: `Swap approval ${requestId}`,
          },
        }),
        tx.shiftAssignment.updateMany({
          where: { shiftId: request.shift.id, employeeId: request.requestingEmployee.id },
          data: { status: 'swapped' },
        }),
      ]);

      await tx.shiftSwapRequest.update({
        where: { id: requestId },
        data: { status: 'approved', resolvedById: reviewerUserId, resolvedAt: new Date() },
      });
      await tx.shiftHistory.create({
        data: {
          shiftId: request.shift.id,
          changedById: reviewerUserId,
          changeType: 'swap_approved',
          after: { assignmentId: newAssignment.id, requestId },
        },
      });
      return newAssignment;
    });

    for (const recipient of [request.requestingEmployee, request.targetEmployee]) {
      if (recipient?.userId) {
        await this.notifyUser({
          companyId,
          userId: recipient.userId,
          eventType: 'swap.approved',
          title: 'Swap approved',
          body: `The swap for shift '${request.shift.name}' was approved`,
          relatedEntityType: 'shift',
          relatedEntityId: request.shift.id,
        });
      }
    }

    return result;
  }

  async listSwapRequests(companyId: string) {
    return this.prisma.shiftSwapRequest.findMany({
      where: { companyId },
      include: {
        requestingEmployee: { select: { id: true, firstName: true, lastName: true } },
        targetEmployee: { select: { id: true, firstName: true, lastName: true } },
        shift: { select: { id: true, name: true, startAt: true, endAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---- Self-service request ledger (employee app) ----

  /**
   * The current employee's own open-shift and swap requests, plus any swap
   * requests directed at them that they may still respond to. Scoped strictly
   * to the caller's own employee profile.
   */
  async findMyRequests(companyId: string, userId: string) {
    const employeeId = await this.resolveEmployeeIdForUser(companyId, userId);

    const [openShiftRequests, swapRequests] = await Promise.all([
      this.prisma.openShiftRequest.findMany({
        where: { companyId, employeeId },
        include: {
          shift: { select: { id: true, name: true, startAt: true, endAt: true, isOpen: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.shiftSwapRequest.findMany({
        where: {
          companyId,
          OR: [{ requestingEmployeeId: employeeId }, { targetEmployeeId: employeeId }],
        },
        include: {
          requestingEmployee: { select: { id: true, firstName: true, lastName: true } },
          targetEmployee: { select: { id: true, firstName: true, lastName: true } },
          shift: { select: { id: true, name: true, startAt: true, endAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { openShiftRequests, swapRequests };
  }

  // ---- In-app notification helpers ----

  /** Best-effort in-app notification; never lets a notification failure break scheduling. */
  private async notifyUser(input: {
    companyId: string;
    userId: string;
    eventType: string;
    title: string;
    body: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  }) {
    try {
      await this.notifications.createForUser({
        companyId: input.companyId,
        recipientUserId: input.userId,
        eventType: input.eventType,
        title: input.title,
        body: input.body,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
      });
    } catch (err) {
      this.logger.warn(`Failed to raise ${input.eventType} notification: ${(err as Error).message}`);
    }
  }

  /** Notify the user(s) behind a set of (shift, employee) pairs for a given event. */
  private async notifyAssignmentUsers(
    companyId: string,
    pairs: Array<{ shiftId: string; employeeId: string }>,
    eventType: string,
  ) {
    if (pairs.length === 0) return;
    const uniquePairs = [...new Map(pairs.map((p) => [`${p.shiftId}:${p.employeeId}`, p])).values()];
    const [employees, shifts] = await Promise.all([
      this.prisma.employee.findMany({
        where: { id: { in: [...new Set(uniquePairs.map((p) => p.employeeId))] } },
        select: { id: true, userId: true, firstName: true, lastName: true },
      }),
      this.prisma.shift.findMany({
        where: { id: { in: [...new Set(uniquePairs.map((p) => p.shiftId))] } },
        select: { id: true, name: true },
      }),
    ]);
    const userIdByEmployee = new Map(
      employees.filter((e) => e.userId).map((e) => [e.id, e.userId as string]),
    );
    const shiftById = new Map(shifts.map((s) => [s.id, s]));

    for (const pair of uniquePairs) {
      const userId = userIdByEmployee.get(pair.employeeId);
      if (!userId) continue;
      const shift = shiftById.get(pair.shiftId);
      const isPublish = eventType === 'schedule.published';
      const title = isPublish
        ? 'Your schedule has been published'
        : 'New shift assigned';
      const body = shift
        ? isPublish
          ? `Your schedule includes shift '${shift.name}'`
          : `Shift '${shift.name}' has been assigned to you`
        : isPublish
          ? 'Your schedule has been published'
          : 'A shift has been assigned to you';
      await this.notifyUser({
        companyId,
        userId,
        eventType,
        title,
        body,
        relatedEntityType: 'shift',
        relatedEntityId: pair.shiftId,
      });
    }
  }
}
