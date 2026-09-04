import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SchedulingService } from './scheduling.service';

function companyWideScopeFilter(): never {
  return {
    employeeWhere: async () => undefined,
    employeeRelationWhere: async () => undefined,
    shiftQueryScope: async () => ({ shiftWhere: undefined, assignmentEmployeeWhere: undefined }),
    branchWhere: async () => undefined,
    departmentWhere: async () => undefined,
    teamWhere: async () => undefined,
    positionWhere: async () => undefined,
  } as never;
}

function createDeps() {
  const shift = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  };
  const employee = { findFirst: vi.fn() };
  const shiftAssignment = {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  };
  const leaveRequest = { findFirst: vi.fn() };
  const schedule = { findFirst: vi.fn(), update: vi.fn() };
  const scheduleVersion = { create: vi.fn() };
  const shiftRequirement = { create: vi.fn() };
  const shiftRequirementSkill = { createMany: vi.fn() };
  const shiftRequirementCertification = { createMany: vi.fn() };
  const shiftConflictOverride = { create: vi.fn() };
  const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn({
      shift,
      employee,
      shiftAssignment,
      leaveRequest,
      schedule,
      scheduleVersion,
      shiftRequirement,
      shiftRequirementSkill,
      shiftRequirementCertification,
      shiftConflictOverride,
    } as any),
  );
  const prisma = {
    shift,
    employee,
    shiftAssignment,
    leaveRequest,
    schedule,
    scheduleVersion,
    shiftRequirement,
    shiftRequirementSkill,
    shiftRequirementCertification,
    shiftConflictOverride,
    $transaction,
  };
  return { prisma, shift, employee, shiftAssignment, leaveRequest, scheduleVersion, shiftConflictOverride };
}

const baseShift = {
  id: 's1',
  companyId: 'c1',
  name: 'Morning',
  status: 'draft',
  startAt: new Date('2026-09-02T09:00:00.000Z'),
  endAt: new Date('2026-09-02T17:00:00.000Z'),
};

const activeEmployee = {
  id: 'e1',
  companyId: 'c1',
  status: 'active',
  firstName: 'Jane',
  lastName: 'Doe',
  skills: [],
  certifications: [],
  availabilityRules: [],
  availabilityExceptions: [],
};

describe('SchedulingService — conflict engine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('return a BLOCKING conflict when the employee is inactive', async () => {
    const { prisma, shift, employee } = createDeps();
    shift.findFirst.mockResolvedValue(baseShift);
    employee.findFirst.mockResolvedValue({ ...activeEmployee, status: 'inactive' });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.validateAssignment('c1', 's1', 'e1');

    expect(result.isValid).toBe(false);
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({ type: 'INACTIVE_EMPLOYEE', severity: 'BLOCKING', overrideAllowed: false }),
    );
  });

  it('returns a BLOCKING conflict for an overlapping assigned shift', async () => {
    const { prisma, shift, employee, shiftAssignment } = createDeps();
    shift.findFirst.mockResolvedValue(baseShift);
    employee.findFirst.mockResolvedValue(activeEmployee);
    shiftAssignment.findFirst.mockResolvedValue({
      shiftId: 's9',
      shift: { id: 's9', name: 'Evening', companyId: 'c1' },
    });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.validateAssignment('c1', 's1', 'e1');

    expect(result.isValid).toBe(false);
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({ type: 'OVERLAPPING_SHIFT', severity: 'BLOCKING' }),
    );
  });

  it('returns a BLOCKING conflict when the employee has approved leave in the window', async () => {
    const { prisma, shift, employee, shiftAssignment, leaveRequest } = createDeps();
    shift.findFirst.mockResolvedValue(baseShift);
    employee.findFirst.mockResolvedValue(activeEmployee);
    shiftAssignment.findFirst.mockResolvedValue(null);
    leaveRequest.findFirst.mockResolvedValue({ id: 'l1', status: 'approved' });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.validateAssignment('c1', 's1', 'e1');

    expect(result.isValid).toBe(false);
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({ type: 'APPROVED_LEAVE', severity: 'BLOCKING', overrideAllowed: false }),
    );
  });

  it('reports availability exceptions and min-rest as overridable WARNINGs', async () => {
    const { prisma, shift, employee, shiftAssignment } = createDeps();
    shift.findFirst.mockResolvedValue(baseShift);
    employee.findFirst.mockResolvedValue({
      ...activeEmployee,
      availabilityExceptions: [
        { date: new Date('2026-09-02T00:00:00.000Z'), isAvailable: false, reason: 'Doctor' },
      ],
    });
    // First call (overlap check) -> null; second call (rest check) -> adjacent shift
    shiftAssignment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ shiftId: 's8', shift: { id: 's8', name: 'Close', companyId: 'c1' } });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.validateAssignment('c1', 's1', 'e1');

    expect(result.isValid).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ type: 'AVAILABILITY_EXCEPTION', severity: 'WARNING', overrideAllowed: true }),
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ type: 'MIN_REST', severity: 'WARNING', overrideAllowed: true }),
    );
  });

  it('throws a BadRequestException when assignment has blocking conflicts', async () => {
    const { prisma, shift, employee, shiftAssignment } = createDeps();
    shift.findFirst.mockResolvedValue(baseShift);
    employee.findFirst.mockResolvedValue({ ...activeEmployee, status: 'on_leave' });
    shiftAssignment.findFirst.mockResolvedValue(null);

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    await expect(service.assign('c1', 's1', { employeeId: 'e1' }, 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.shiftAssignment.create).not.toHaveBeenCalled();
  });

  it('throws when warnings are present and no override is given', async () => {
    const { prisma, shift, employee, shiftAssignment } = createDeps();
    shift.findFirst.mockResolvedValue(baseShift);
    employee.findFirst.mockResolvedValue({
      ...activeEmployee,
      availabilityExceptions: [
        { date: new Date('2026-09-02T00:00:00.000Z'), isAvailable: false, reason: 'Appointment' },
      ],
    });
    shiftAssignment.findFirst.mockResolvedValue(null);

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const err = await service
      .assign('c1', 's1', { employeeId: 'e1' }, 'u1')
      .then(() => null)
      .catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((err as any).getResponse().requiresOverride).toBe(true);
  });

  it('creates an assignment when validation is fully clean', async () => {
    const { prisma, shift, employee, shiftAssignment } = createDeps();
    shift.findFirst.mockResolvedValue(baseShift);
    employee.findFirst.mockResolvedValue(activeEmployee);
    shiftAssignment.findFirst.mockResolvedValue(null);
    shiftAssignment.create.mockResolvedValue({ id: 'a1' });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.assign('c1', 's1', { employeeId: 'e1' }, 'u1');

    expect(result).toEqual({ id: 'a1' });
    expect(shiftAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { shiftId: 's1', employeeId: 'e1', status: 'scheduled' } }),
    );
  });

  it('requires a reason and employeeId for conflict override', async () => {
    const { prisma } = createDeps();
    const service = new SchedulingService(prisma, companyWideScopeFilter());

    await expect(service.overrideConflictAndAssign('c1', { shiftId: 's1', ruleIdentifier: 'X', reason: 'ab' } as any, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.overrideConflictAndAssign('c1', { shiftId: 's1', ruleIdentifier: 'X', reason: 'valid reason' } as any, 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates an audited override record and assignment in a transaction', async () => {
    const { prisma, shiftConflictOverride } = createDeps();
    prisma.shiftAssignment.create.mockResolvedValue({ id: 'a9' });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.overrideConflictAndAssign(
      'c1',
      { shiftId: 's1', employeeId: 'e1', ruleIdentifier: 'MIN_REST_HOURS', reason: 'Coverage needed' },
      'u1',
    );

    expect(result).toEqual({ id: 'a9' });
    expect(shiftConflictOverride.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'c1',
          shiftId: 's1',
          employeeId: 'e1',
          ruleIdentifier: 'MIN_REST_HOURS',
          severity: 'WARNING',
          reason: 'Coverage needed',
          overriddenById: 'u1',
        }),
      }),
    );
  });
});

describe('SchedulingService — publishing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an immutable snapshot and publishes the schedule and its shifts', async () => {
    const { prisma, scheduleVersion } = createDeps();
    prisma.schedule.findFirst.mockResolvedValue({
      id: 'sch1',
      companyId: 'c1',
      status: 'draft',
      shifts: [{ id: 's1', name: 'Morning' }],
      versions: [],
    });
    prisma.shift.updateMany.mockResolvedValue({ count: 1 });
    prisma.schedule.update.mockResolvedValue({});

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.publishSchedule('c1', 'sch1', 'u1', 'First publish');

    expect(result).toEqual(expect.objectContaining({ success: true, versionNumber: 1, publishedAt: expect.any(String) }));
    expect(scheduleVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scheduleId: 'sch1', versionNumber: 1, publishedById: 'u1' }),
      }),
    );
    expect(prisma.shift.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scheduleId: 'sch1', companyId: 'c1' },
        data: expect.objectContaining({ status: 'published' }),
      }),
    );
  });

  it('throws NotFoundException for a schedule outside the company tenant', async () => {
    const { prisma } = createDeps();
    prisma.schedule.findFirst.mockResolvedValue(null);

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    await expect(service.publishSchedule('c1', 'sch9', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SchedulingService — availability rule enforcement', () => {
  beforeEach(() => vi.clearAllMocks());

  const ruleDay = new Date('2026-09-02T09:00:00.000Z').getDay();

  it('adds a WARNING when the shift falls outside the employee availability window', async () => {
    const { prisma, shift, employee, shiftAssignment } = createDeps();
    shift.findFirst.mockResolvedValue(baseShift);
    employee.findFirst.mockResolvedValue({
      ...activeEmployee,
      availabilityRules: [
        { dayOfWeek: ruleDay, startTime: '00:00', endTime: '08:00', isAvailable: true, effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null },
      ],
    });
    shiftAssignment.findFirst.mockResolvedValue(null);

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.validateAssignment('c1', 's1', 'e1');

    expect(result.isValid).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ type: 'AVAILABILITY_RULE_WINDOW', severity: 'WARNING', overrideAllowed: true }),
    );
  });

  it('adds a WARNING when the employee has a not-available rule for the day', async () => {
    const { prisma, shift, employee, shiftAssignment } = createDeps();
    shift.findFirst.mockResolvedValue(baseShift);
    employee.findFirst.mockResolvedValue({
      ...activeEmployee,
      availabilityRules: [
        { dayOfWeek: ruleDay, startTime: '09:00', endTime: '17:00', isAvailable: false, effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null },
      ],
    });
    shiftAssignment.findFirst.mockResolvedValue(null);

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.validateAssignment('c1', 's1', 'e1');

    expect(result.isValid).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ type: 'AVAILABILITY_RULE', severity: 'WARNING', overrideAllowed: true }),
    );
  });

  it('does not add a warning when the shift is within the availability window', async () => {
    const { prisma, shift, employee, shiftAssignment } = createDeps();
    shift.findFirst.mockResolvedValue(baseShift);
    employee.findFirst.mockResolvedValue({
      ...activeEmployee,
      availabilityRules: [
        { dayOfWeek: ruleDay, startTime: '09:00', endTime: '17:00', isAvailable: true, effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null },
      ],
    });
    shiftAssignment.findFirst.mockResolvedValue(null);

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.validateAssignment('c1', 's1', 'e1');

    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.type === 'AVAILABILITY_RULE' || w.type === 'AVAILABILITY_RULE_WINDOW')).toBe(false);
  });
});

describe('SchedulingService — coverage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('computes required vs filled headcount and shortfall', async () => {
    const { prisma, shift } = createDeps();
    shift.findMany.mockResolvedValue([
      {
        id: 's1',
        requirements: [{ id: 'r1', headcount: 2 }, { id: 'r2', headcount: 1 }],
        assignments: [
          { id: 'a1', status: 'scheduled' },
          { id: 'a2', status: 'confirmed' },
        ],
      },
      {
        id: 's2',
        requirements: [{ id: 'r3', headcount: 1 }],
        assignments: [],
      },
    ]);

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.coverage('c1', ['s1', 's2'], 'm1');

    expect(result).toEqual([
      expect.objectContaining({ shiftId: 's1', headcountRequired: 3, headcountFilled: 2, shortfall: 1, covered: false }),
      expect.objectContaining({ shiftId: 's2', headcountRequired: 1, headcountFilled: 0, shortfall: 1, covered: false }),
    ]);
  });
});
