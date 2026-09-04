import { ServiceUnavailableException } from '@nestjs/common';
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

function createOptimizeDeps() {
  const shift = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
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
  const optimizationRequest = { create: vi.fn(), findFirst: vi.fn() };
  const schedule = { findFirst: vi.fn(), update: vi.fn() };
  const scheduleVersion = { create: vi.fn() };
  const shiftRequirement = { create: vi.fn() };
  const shiftRequirementSkill = { createMany: vi.fn() };
  const shiftRequirementCertification = { createMany: vi.fn() };
  const shiftConflictOverride = { create: vi.fn() };
  const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
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
      optimizationRequest,
    } as any),
  );
  const prisma = {
    shift,
    employee,
    shiftAssignment,
    leaveRequest,
    optimizationRequest,
    $transaction,
  };

  const optimizer = { optimize: vi.fn() };
  return { prisma, shift, employee, shiftAssignment, leaveRequest, optimizationRequest, optimizer };
}

const baseShift = {
  id: 's1',
  companyId: 'c1',
  name: 'Morning',
  status: 'draft',
  startAt: new Date('2026-09-05T09:00:00.000Z'),
  endAt: new Date('2026-09-05T17:00:00.000Z'),
  requirements: [{ id: 'r1', headcount: 1 }],
  assignments: [],
};

const activeEmployee = {
  id: 'e1',
  companyId: 'c1',
  status: 'active',
  firstName: 'Alice',
  lastName: 'Smith',
  email: 'alice@test.com',
};

const activeEmployee2 = {
  id: 'e2',
  companyId: 'c1',
  status: 'active',
  firstName: 'Bob',
  lastName: 'Jones',
  email: 'bob@test.com',
};

function buildService(deps: ReturnType<typeof createOptimizeDeps>) {
  const service = new SchedulingService(
    deps.prisma as any,
    companyWideScopeFilter(),
    deps.optimizer as any,
  );
  return service;
}

describe('SchedulingService — generateSuggestions', () => {
  let deps: ReturnType<typeof createOptimizeDeps>;
  let service: SchedulingService;

  beforeEach(() => {
    deps = createOptimizeDeps();
    service = buildService(deps);
  });

  it('returns no_shifts when no shifts exist in range', async () => {
    deps.shift.findMany.mockResolvedValue([]);

    const result = await service.generateSuggestions(
      'c1',
      {
        branchId: 'b1',
        startDate: '2026-09-05T00:00:00.000Z',
        endDate: '2026-09-11T23:59:59.000Z',
      },
      'user1',
      'm1',
    );

    expect(result.status).toBe('no_shifts');
    expect(result.shiftsConsidered).toBe(0);
    expect(result.suggestedCount).toBe(0);
    expect(deps.optimizer.optimize).not.toHaveBeenCalled();
  });

  it('calls optimizer and revalidates proposals — drops BLOCKING', async () => {
    deps.shift.findMany.mockResolvedValue([baseShift]);
    deps.employee.findMany.mockResolvedValue([activeEmployee, activeEmployee2]);
    deps.leaveRequest.findMany.mockResolvedValue([]);
    deps.shiftAssignment.findMany.mockResolvedValue([]);

    // Optimizer proposes both employees to the same shift
    deps.optimizer.optimize.mockResolvedValue({
      status: 'optimal',
      assignments: [
        { shift_id: 's1', employee_id: 'e1' },
        { shift_id: 's1', employee_id: 'e2' },
      ],
      solver_time_seconds: 0.5,
      unmet_shifts: [],
    });

    // validateAssignment: first call returns valid, second returns BLOCKING
    // (overlap — same shift assigned twice)
    let validateCallCount = 0;
    vi.spyOn(service, 'validateAssignment').mockImplementation(async (companyId, shiftId, employeeId) => {
      validateCallCount += 1;
      if (validateCallCount === 2) {
        return {
          isValid: false,
          conflicts: [
            {
              type: 'OVERLAPPING_SHIFT',
              severity: 'BLOCKING',
              shiftId,
              employeeId,
              ruleIdentifier: 'SHIFT_OVERLAP',
              message: 'Already assigned',
              overrideAllowed: false,
            },
          ],
          warnings: [],
        };
      }
      return { isValid: true, conflicts: [], warnings: [] };
    });

    const result = await service.generateSuggestions(
      'c1',
      {
        branchId: 'b1',
        startDate: '2026-09-05T00:00:00.000Z',
        endDate: '2026-09-11T23:59:59.000Z',
      },
      'user1',
      'm1',
    );

    expect(deps.optimizer.optimize).toHaveBeenCalledTimes(1);
    expect(result.shiftsConsidered).toBe(1);
    expect(result.suggestedCount).toBe(1);
    expect(result.droppedBlocking).toBe(1);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].employeeId).toBe('e1');
  });

  it('persists OptimizationRequest record with result', async () => {
    deps.shift.findMany.mockResolvedValue([baseShift]);
    deps.employee.findMany.mockResolvedValue([activeEmployee]);
    deps.leaveRequest.findMany.mockResolvedValue([]);
    deps.shiftAssignment.findMany.mockResolvedValue([]);
    deps.optimizationRequest.create.mockResolvedValue({});

    deps.optimizer.optimize.mockResolvedValue({
      status: 'optimal',
      assignments: [{ shift_id: 's1', employee_id: 'e1' }],
      solver_time_seconds: 0.5,
      unmet_shifts: [],
    });

    vi.spyOn(service, 'validateAssignment').mockResolvedValue({
      isValid: true,
      conflicts: [],
      warnings: [],
    });

    await service.generateSuggestions(
      'c1',
      { branchId: 'b1', startDate: '2026-09-05T00:00:00.000Z', endDate: '2026-09-11T23:59:59.000Z' },
      'user1',
      'm1',
    );

    expect(deps.optimizationRequest.create).toHaveBeenCalledTimes(1);
    const callArgs = deps.optimizationRequest.create.mock.calls[0][0].data;
    expect(callArgs.companyId).toBe('c1');
    expect(callArgs.requestedById).toBe('user1');
    expect(callArgs.status).toBe('completed');
    expect(callArgs.path).toBe('interactive');
    expect(callArgs.idempotencyKey).toBeDefined();
  });

  it('propagates ServiceUnavailableException when optimizer is down', async () => {
    deps.shift.findMany.mockResolvedValue([baseShift]);
    deps.employee.findMany.mockResolvedValue([activeEmployee]);
    deps.leaveRequest.findMany.mockResolvedValue([]);
    deps.shiftAssignment.findMany.mockResolvedValue([]);

    deps.optimizer.optimize.mockRejectedValue(
      new ServiceUnavailableException('Schedule optimizer is unavailable'),
    );

    await expect(
      service.generateSuggestions(
        'c1',
        { branchId: 'b1', startDate: '2026-09-05T00:00:00.000Z', endDate: '2026-09-11T23:59:59.000Z' },
        'user1',
        'm1',
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});

describe('SchedulingService — applySuggestions', () => {
  let deps: ReturnType<typeof createOptimizeDeps>;
  let service: SchedulingService;

  beforeEach(() => {
    deps = createOptimizeDeps();
    service = buildService(deps);
  });

  it('applies clean pairs and skips already-assigned', async () => {
    // First pair: no existing → should be applied
    // Second pair: already assigned → should be skipped
    deps.shiftAssignment.findFirst
      .mockResolvedValueOnce(null) // e1 not on s1
      .mockResolvedValueOnce({ id: 'existing' }); // e2 already on s2

    vi.spyOn(service, 'validateAssignment').mockResolvedValue({
      isValid: true,
      conflicts: [],
      warnings: [],
    });

    deps.optimizationRequest.create.mockResolvedValue({});

    const result = await service.applySuggestions('c1', {
      branchId: 'b1',
      startDate: '2026-09-05T00:00:00.000Z',
      endDate: '2026-09-11T23:59:59.000Z',
      assignments: [
        { shiftId: 's1', employeeId: 'e1' },
        { shiftId: 's2', employeeId: 'e2' },
      ],
    }, 'user1');

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].employeeId).toBe('e1');
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('already_assigned');
    expect(result.rejected).toHaveLength(0);
  });

  it('rejects pairs with BLOCKING conflicts', async () => {
    deps.shiftAssignment.findFirst.mockResolvedValue(null); // no existing

    vi.spyOn(service, 'validateAssignment').mockResolvedValue({
      isValid: false,
      conflicts: [
        {
          type: 'APPROVED_LEAVE',
          severity: 'BLOCKING',
          shiftId: 's1',
          employeeId: 'e1',
          ruleIdentifier: 'LEAVE_CONSTRAINTS',
          message: 'Employee has approved leave',
          overrideAllowed: false,
        },
      ],
      warnings: [],
    });

    deps.optimizationRequest.create.mockResolvedValue({});

    const result = await service.applySuggestions('c1', {
      branchId: 'b1',
      startDate: '2026-09-05T00:00:00.000Z',
      endDate: '2026-09-11T23:59:59.000Z',
      assignments: [{ shiftId: 's1', employeeId: 'e1' }],
    }, 'user1');

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].conflicts).toHaveLength(1);
    expect(result.rejected[0].conflicts[0].type).toBe('APPROVED_LEAVE');
  });

  it('records an audit record in OptimizationRequest', async () => {
    deps.shiftAssignment.findFirst.mockResolvedValue(null);
    vi.spyOn(service, 'validateAssignment').mockResolvedValue({
      isValid: true,
      conflicts: [],
      warnings: [],
    });
    deps.optimizationRequest.create.mockResolvedValue({});

    await service.applySuggestions('c1', {
      branchId: 'b1',
      startDate: '2026-09-05T00:00:00.000Z',
      endDate: '2026-09-11T23:59:59.000Z',
      assignments: [{ shiftId: 's1', employeeId: 'e1' }],
    }, 'user1');

    expect(deps.optimizationRequest.create).toHaveBeenCalledTimes(1);
    const callData = deps.optimizationRequest.create.mock.calls[0][0].data;
    expect(callData.status).toBe('completed');
    expect(callData.requestedById).toBe('user1');
  });
});
