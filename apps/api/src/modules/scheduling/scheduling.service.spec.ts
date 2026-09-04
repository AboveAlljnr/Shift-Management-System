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
    update: vi.fn(),
    updateMany: vi.fn(),
  };
  const employee = { findFirst: vi.fn(), findMany: vi.fn() };
  const shiftAssignment = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  };
  const leaveRequest = { findFirst: vi.fn(), findMany: vi.fn() };
  const schedule = { findFirst: vi.fn(), update: vi.fn() };
  const scheduleVersion = { create: vi.fn() };
  const shiftRequirement = { create: vi.fn() };
  const shiftRequirementSkill = { createMany: vi.fn() };
  const shiftRequirementCertification = { createMany: vi.fn() };
  const shiftConflictOverride = { create: vi.fn() };
  const openShiftRequest = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
  const shiftSwapRequest = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
  const shiftHistory = { create: vi.fn() };
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
      openShiftRequest,
      shiftSwapRequest,
      shiftHistory,
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
    openShiftRequest,
    shiftSwapRequest,
    shiftHistory,
    $transaction,
  };
  return {
    prisma,
    shift,
    employee,
    shiftAssignment,
    leaveRequest,
    scheduleVersion,
    shiftConflictOverride,
    openShiftRequest,
    shiftSwapRequest,
    shiftHistory,
  };
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
    employee.findMany.mockResolvedValue([]);
    shift.findMany.mockResolvedValue([]);
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

  it('rejects an override attempt for a qualification conflict', async () => {
    const { prisma, shiftConflictOverride } = createDeps();

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    await expect(
      service.overrideConflictAndAssign(
        'c1',
        { shiftId: 's1', employeeId: 'e1', ruleIdentifier: 'QUALIFICATIONS', reason: 'Coverage needed' },
        'u1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(shiftConflictOverride.create).not.toHaveBeenCalled();
    expect(prisma.shiftAssignment.create).not.toHaveBeenCalled();
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

describe('SchedulingService — qualification conflict engine', () => {
  beforeEach(() => vi.clearAllMocks());

  const qualifiedShift = {
    ...baseShift,
    requirements: [
      {
        id: 'r1',
        headcount: 1,
        skills: [{ skillId: 'sk1', skill: { name: 'Cash Handling' } }],
        certifications: [{ certificationId: 'cr1', certification: { name: 'Food Handling' } }],
      },
    ],
  };

  it('blocks an assignment when the employee lacks a required skill', async () => {
    const { prisma, shift, employee } = createDeps();
    shift.findFirst.mockResolvedValue(qualifiedShift);
    employee.findFirst.mockResolvedValue({
      ...activeEmployee,
      skills: [{ id: 'es', skillId: 'SK_OTHER', skill: { isActive: true } }],
      certifications: [
        { id: 'ec', certificationId: 'cr1', certification: { isActive: true }, expiresAt: new Date('2099-01-01T00:00:00.000Z') },
      ],
    });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.validateAssignment('c1', 's1', 'e1');

    expect(result.isValid).toBe(false);
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        type: 'MISSING_SKILL',
        severity: 'BLOCKING',
        ruleIdentifier: 'QUALIFICATIONS',
        overrideAllowed: false,
      }),
    );
  });

  it('blocks an assignment when the employee lacks a required certification', async () => {
    const { prisma, shift, employee } = createDeps();
    shift.findFirst.mockResolvedValue(qualifiedShift);
    employee.findFirst.mockResolvedValue({
      ...activeEmployee,
      skills: [{ id: 'es', skillId: 'sk1', skill: { isActive: true } }],
      certifications: [],
    });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.validateAssignment('c1', 's1', 'e1');

    expect(result.conflicts.some((c) => c.type === 'MISSING_CERTIFICATION')).toBe(true);
  });

  it('blocks an assignment when a required certification expired before the shift', async () => {
    const { prisma, shift, employee } = createDeps();
    shift.findFirst.mockResolvedValue(qualifiedShift);
    employee.findFirst.mockResolvedValue({
      ...activeEmployee,
      skills: [{ id: 'es', skillId: 'sk1', skill: { isActive: true } }],
      certifications: [
        { id: 'ec', certificationId: 'cr1', certification: { isActive: true }, expiresAt: new Date('2020-01-01T00:00:00.000Z') },
      ],
    });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.validateAssignment('c1', 's1', 'e1');

    expect(result.isValid).toBe(false);
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({ type: 'EXPIRED_CERTIFICATION', severity: 'BLOCKING', overrideAllowed: false }),
    );
  });

  it('passes when the employee holds every required qualification', async () => {
    const { prisma, shift, employee, shiftAssignment } = createDeps();
    shift.findFirst.mockResolvedValue(qualifiedShift);
    employee.findFirst.mockResolvedValue({
      ...activeEmployee,
      skills: [{ id: 'es', skillId: 'sk1', skill: { isActive: true } }],
      certifications: [
        { id: 'ec', certificationId: 'cr1', certification: { isActive: true }, expiresAt: new Date('2099-01-01T00:00:00.000Z') },
      ],
    });
    shiftAssignment.findFirst.mockResolvedValue(null);

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.validateAssignment('c1', 's1', 'e1');

    expect(result.isValid).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  it('blocks an assignment to an archived (inactive) required certification', async () => {
    const { prisma, shift, employee } = createDeps();
    shift.findFirst.mockResolvedValue(qualifiedShift);
    employee.findFirst.mockResolvedValue({
      ...activeEmployee,
      skills: [{ id: 'es', skillId: 'sk1', skill: { isActive: true } }],
      certifications: [
        { id: 'ec', certificationId: 'cr1', certification: { isActive: false }, expiresAt: null },
      ],
    });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.validateAssignment('c1', 's1', 'e1');

    expect(result.conflicts.some((c) => c.type === 'EXPIRED_CERTIFICATION')).toBe(true);
  });
});

describe('SchedulingService — open shifts (P6)', () => {
  beforeEach(() => vi.clearAllMocks());

  const openShift = {
    id: 's1',
    companyId: 'c1',
    branchId: 'b1',
    name: 'Morning',
    isOpen: false,
    startAt: new Date('2026-09-02T09:00:00.000Z'),
    endAt: new Date('2026-09-02T17:00:00.000Z'),
    requirements: [],
  };

  it('opens a shift, audits it, and notifies eligible employees', async () => {
    const { prisma, shift, employee, leaveRequest, shiftAssignment, shiftHistory } = createDeps();
    shift.findFirst.mockResolvedValue(openShift);
    shift.update.mockResolvedValue({ ...openShift, isOpen: true });
    shiftHistory.create.mockResolvedValue({ id: 'h1' });
    employee.findMany.mockResolvedValue([
      { id: 'e1', companyId: 'c1', status: 'active', branchId: 'b1', userId: 'u1', skills: [], certifications: [], availabilityRules: [], availabilityExceptions: [] },
    ]);
    leaveRequest.findMany.mockResolvedValue([]);
    shiftAssignment.findMany.mockResolvedValue([]);
    shift.findMany.mockResolvedValue([{ id: 's1', name: 'Morning' }]);

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.setShiftOpen('c1', 's1', true, 'mgr1');

    expect(shift.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' }, data: { isOpen: true } }),
    );
    expect(shiftHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ changeType: 'shift_opened' }) }),
    );
    expect(result.notifiedEmployees).toBe(1);
  });

  it('is a no-op when the shift is already in the target state', async () => {
    const { prisma, shift, shiftHistory } = createDeps();
    shift.findFirst.mockResolvedValue({ ...openShift, isOpen: true });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.setShiftOpen('c1', 's1', true, 'mgr1');

    expect(result.notifiedEmployees).toBe(0);
    expect(shift.update).not.toHaveBeenCalled();
    expect(shiftHistory.create).not.toHaveBeenCalled();
  });

  it('rejects a request for a shift that is not open', async () => {
    const { prisma, employee, shift } = createDeps();
    employee.findFirst.mockResolvedValue({ id: 'e1' });
    shift.findFirst.mockResolvedValue(null);

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    await expect(
      service.requestOpenShift('c1', { shiftId: 's1', note: 'open' }, 'u1'),
    ).rejects.toThrow('not open for requests');
  });

  it('rejects a duplicate pending request for an open shift', async () => {
    const { prisma, employee, shift, shiftAssignment, openShiftRequest } = createDeps();
    employee.findFirst.mockResolvedValue({ id: 'e1' });
    shift.findFirst.mockResolvedValue({ id: 's1', name: 'Morning' });
    shiftAssignment.findFirst.mockResolvedValue(null);
    openShiftRequest.findFirst.mockResolvedValue({ id: 'dup', status: 'pending' });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    await expect(
      service.requestOpenShift('c1', { shiftId: 's1', note: 'open' }, 'u1'),
    ).rejects.toThrow('already have a pending request');
  });

  it('creates a request for an open shift when the employee qualifies', async () => {
    const { prisma, employee, shift, shiftAssignment, openShiftRequest } = createDeps();
    employee.findFirst.mockResolvedValue({ id: 'e1' });
    shift.findFirst.mockResolvedValue({ id: 's1', name: 'Morning' });
    shiftAssignment.findFirst.mockResolvedValue(null);
    openShiftRequest.findFirst.mockResolvedValue(null);
    openShiftRequest.create.mockResolvedValue({ id: 'req1', status: 'pending' });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    vi.spyOn(service, 'validateAssignment').mockResolvedValue({ isValid: true, conflicts: [] });

    const result = await service.requestOpenShift('c1', { shiftId: 's1', note: 'open' }, 'u1');

    expect(openShiftRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ shiftId: 's1', employeeId: 'e1' }) }),
    );
    expect(result).toEqual({ id: 'req1', status: 'pending' });
  });

  it('declines an open-shift request when the employee no longer qualifies', async () => {
    const { prisma, employee, shift, shiftAssignment, openShiftRequest } = createDeps();
    employee.findFirst.mockResolvedValue({ id: 'e1' });
    shift.findFirst.mockResolvedValue({ id: 's1', name: 'Morning' });
    shiftAssignment.findFirst.mockResolvedValue(null);
    openShiftRequest.findFirst.mockResolvedValue(null);

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    vi.spyOn(service, 'validateAssignment').mockResolvedValue({
      isValid: false,
      conflicts: [{ type: 'MISSING_SKILL', message: 'Requires BARISTA' }],
    });

    await expect(
      service.requestOpenShift('c1', { shiftId: 's1', note: 'open' }, 'u1'),
    ).rejects.toThrow('Requires BARISTA');
  });

  it('rejects a pending open-shift request without assigning the shift', async () => {
    const { prisma, openShiftRequest } = createDeps();
    openShiftRequest.findFirst.mockResolvedValue({
      id: 'req1',
      status: 'pending',
      companyId: 'c1',
      shiftId: 's1',
      employee: { id: 'e1', userId: 'u1' },
      shift: { id: 's1', name: 'Morning' },
    });
    openShiftRequest.update.mockResolvedValue({ id: 'req1', status: 'rejected' });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.reviewOpenShiftRequest('c1', 'req1', { action: 'reject' }, 'mgr1');

    expect(openShiftRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'req1' }, data: expect.objectContaining({ status: 'rejected' }) }),
    );
    expect(result.status).toBe('rejected');
  });

  it('approves a qualified open-shift request inside a transaction', async () => {
    const { prisma, openShiftRequest, shiftAssignment, shiftHistory } = createDeps();
    openShiftRequest.findFirst.mockResolvedValue({
      id: 'req1',
      status: 'pending',
      companyId: 'c1',
      shiftId: 's1',
      employee: { id: 'e1', userId: 'u1', firstName: 'Jane', lastName: 'Doe' },
      shift: { id: 's1', name: 'Morning' },
    });
    shiftAssignment.findFirst.mockResolvedValue(null);
    shiftAssignment.create.mockResolvedValue({ id: 'a1', status: 'scheduled' });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    vi.spyOn(service, 'validateAssignment').mockResolvedValue({ isValid: true, conflicts: [] });

    const result = await service.reviewOpenShiftRequest('c1', 'req1', { action: 'approve' }, 'mgr1');

    expect(result).toEqual({ id: 'a1', status: 'scheduled' });
    expect(openShiftRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'req1' }, data: expect.objectContaining({ status: 'approved' }) }),
    );
    expect(shiftHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ changeType: 'open_shift_approved' }) }),
    );
  });

  it('refuses to approve when the employee no longer qualifies', async () => {
    const { prisma, openShiftRequest } = createDeps();
    openShiftRequest.findFirst.mockResolvedValue({
      id: 'req1',
      status: 'pending',
      companyId: 'c1',
      shiftId: 's1',
      employee: { id: 'e1', userId: 'u1' },
      shift: { id: 's1', name: 'Morning' },
    });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    vi.spyOn(service, 'validateAssignment').mockResolvedValue({
      isValid: false,
      conflicts: [{ type: 'MISSING_SKILL', message: 'Requires BARISTA' }],
    });

    await expect(
      service.reviewOpenShiftRequest('c1', 'req1', { action: 'approve' }, 'mgr1'),
    ).rejects.toThrow('no longer qualifies');
  });
});

describe('SchedulingService — shift swaps (P7)', () => {
  beforeEach(() => vi.clearAllMocks());

  const swapRequestRow = {
    id: 'sw1',
    status: 'accepted',
    companyId: 'c1',
    shiftId: 's1',
    requestingEmployeeId: 'e1',
    targetEmployeeId: 'e2',
    requestingEmployee: { id: 'e1', userId: 'u1', firstName: 'Jane', lastName: 'Doe' },
    targetEmployee: { id: 'e2', userId: 'u2', firstName: 'Bob', lastName: 'Smith' },
    shift: { id: 's1', name: 'Morning' },
  };

  it('blocks self-response to a swap request', async () => {
    const { prisma, employee, shiftSwapRequest } = createDeps();
    employee.findFirst.mockResolvedValue({ id: 'e1' });
    shiftSwapRequest.findFirst.mockResolvedValue({ ...swapRequestRow, status: 'pending', requestingEmployeeId: 'e1' });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    await expect(
      service.respondSwap('c1', 'sw1', { action: 'accept' }, 'u1'),
    ).rejects.toThrow('cannot respond to your own swap request');
  });

  it('blocks a response from an employee the request was not directed at', async () => {
    const { prisma, employee, shiftSwapRequest } = createDeps();
    employee.findFirst.mockResolvedValue({ id: 'e2' });
    shiftSwapRequest.findFirst.mockResolvedValue({ ...swapRequestRow, status: 'pending', targetEmployeeId: 'e3' });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    await expect(
      service.respondSwap('c1', 'sw1', { action: 'accept' }, 'u2'),
    ).rejects.toThrow('directed at another employee');
  });

  it('accepts a swap and binds the responding employee as its target', async () => {
    const { prisma, employee, shiftSwapRequest } = createDeps();
    employee.findFirst.mockResolvedValue({ id: 'e2' });
    shiftSwapRequest.findFirst.mockResolvedValue({ ...swapRequestRow, status: 'pending', targetEmployeeId: null });
    shiftSwapRequest.update.mockResolvedValue({ ...swapRequestRow, status: 'accepted', targetEmployeeId: 'e2' });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.respondSwap('c1', 'sw1', { action: 'accept' }, 'u2');

    expect(shiftSwapRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sw1' }, data: expect.objectContaining({ status: 'accepted', targetEmployeeId: 'e2' }) }),
    );
    expect(result.targetEmployeeId).toBe('e2');
  });

  it('only lets a manager review an accepted swap', async () => {
    const { prisma, shiftSwapRequest } = createDeps();
    shiftSwapRequest.findFirst.mockResolvedValue({ ...swapRequestRow, status: 'pending' });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    await expect(
      service.reviewSwap('c1', 'sw1', { action: 'approve' }, 'mgr1'),
    ).rejects.toThrow('Only accepted swap requests');
  });

  it('declines a swap through the review flow', async () => {
    const { prisma, shiftSwapRequest } = createDeps();
    shiftSwapRequest.findFirst.mockResolvedValue(swapRequestRow);
    shiftSwapRequest.update.mockResolvedValue({ ...swapRequestRow, status: 'rejected' });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    const result = await service.reviewSwap('c1', 'sw1', { action: 'reject' }, 'mgr1');

    expect(shiftSwapRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sw1' }, data: expect.objectContaining({ status: 'rejected', resolvedById: 'mgr1' }) }),
    );
    expect(result.status).toBe('rejected');
  });

  it('approves a swap: reassigns the shift to the target and marks the original swapped', async () => {
    const { prisma, shiftAssignment, shiftSwapRequest, shiftHistory } = createDeps();
    shiftSwapRequest.findFirst.mockResolvedValue(swapRequestRow);
    shiftAssignment.findFirst.mockResolvedValue(null);
    shiftAssignment.create.mockResolvedValue({ id: 'a2', status: 'scheduled' });

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    vi.spyOn(service, 'validateAssignment').mockResolvedValue({ isValid: true, conflicts: [] });

    const result = await service.reviewSwap('c1', 'sw1', { action: 'approve' }, 'mgr1');

    expect(result.id).toBe('a2');
    expect(shiftAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ employeeId: 'e2', status: 'scheduled' }) }),
    );
    expect(shiftAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ employeeId: 'e1' }), data: { status: 'swapped' } }),
    );
    expect(shiftSwapRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sw1' }, data: expect.objectContaining({ status: 'approved' }) }),
    );
    expect(shiftHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ changeType: 'swap_approved' }) }),
    );
  });

  it('blocks swap approval when the target no longer qualifies', async () => {
    const { prisma, shiftSwapRequest } = createDeps();
    shiftSwapRequest.findFirst.mockResolvedValue(swapRequestRow);

    const service = new SchedulingService(prisma, companyWideScopeFilter());
    vi.spyOn(service, 'validateAssignment').mockResolvedValue({
      isValid: false,
      conflicts: [{ type: 'EXPIRED_CERTIFICATION', message: 'FOOD expired' }],
    });

    await expect(
      service.reviewSwap('c1', 'sw1', { action: 'approve' }, 'mgr1'),
    ).rejects.toThrow('FOOD expired');
  });
});
