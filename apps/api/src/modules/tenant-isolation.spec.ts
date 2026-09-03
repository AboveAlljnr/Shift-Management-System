import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CompanyId } from '../common/decorators/current-user.decorator';

import { AttendanceService } from './attendance/attendance.service';
import { EmployeeService } from './employee/employee.service';
import { LeaveService } from './leave/leave.service';
import { OrganizationService } from './organization/organization.service';
import { SchedulingService } from './scheduling/scheduling.service';

/**
 * Stub ScopeFilterService that resolves a company-wide grant for the active
 * tenant, so the tenant-isolation invariants below stay focused on companyId
 * qualification (no extra scope predicate is injected).
 */
function companyWideScopeFilter(): never {
  const noScope = async () => undefined;
  const noShiftScope = async () => ({ shiftWhere: undefined, assignmentEmployeeWhere: undefined });
  const unrestricted = async () => ({
    unrestricted: true,
    buckets: { branchIds: [], departmentIds: [], teamIds: [], employeeIds: [] },
  });
  return {
    employeeWhere: noScope,
    employeeRelationWhere: noScope,
    shiftQueryScope: noShiftScope,
    branchWhere: noScope,
    departmentWhere: noScope,
    teamWhere: noScope,
    positionWhere: noScope,
    resolveScope: unrestricted,
  } as never;
}

/**
 * Tenant isolation invariant (ADR-001): every read of a tenant-scoped entity must
 * be qualified by the caller's companyId. When an entity belongs to another company
 * the service must surface NOT_FOUND — never the data.
 */

describe('Tenant isolation — cross-company reads return NOT_FOUND', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SchedulingService.findById hides shifts owned by another company', async () => {
    const shift = { findFirst: vi.fn().mockResolvedValue(null) };
    const prisma = { shift } as never;
    await expect(new SchedulingService(prisma, companyWideScopeFilter()).findById('company-a', 'shift-of-company-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(shift.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'shift-of-company-b', companyId: 'company-a' } }),
    );
  });

  it('EmployeeService.findById hides employees owned by another company', async () => {
    const employee = { findFirst: vi.fn().mockResolvedValue(null) };
    const prisma = { employee } as never;
    await expect(new EmployeeService(prisma, companyWideScopeFilter()).findById('company-a', 'emp-of-company-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(employee.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'emp-of-company-b', companyId: 'company-a' } }),
    );
  });

  it('LeaveService.reviewLeaveRequest cannot review requests of another company', async () => {
    const leaveRequest = { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() };
    const prisma = { leaveRequest } as never;
    await expect(
      new LeaveService(prisma, companyWideScopeFilter()).reviewLeaveRequest('company-a', 'req-of-company-b', { action: 'approve' }, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(leaveRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'req-of-company-b', companyId: 'company-a' } }),
    );
  });

  it('AttendanceService.recordCorrection rejects corrections for another company', async () => {
    const attendanceRecord = { findFirst: vi.fn().mockResolvedValue(null) };
    const prisma = { attendanceRecord } as never;
    await expect(
      new AttendanceService(prisma, companyWideScopeFilter()).recordCorrection('company-a', { attendanceRecordId: 'rec-of-company-b', field: 'status', newValue: 'present', reason: 'x' }, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(attendanceRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rec-of-company-b', companyId: 'company-a' } }),
    );
  });
});

describe('Tenant isolation — list reads are qualified by caller company', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SchedulingService.findAll scopes shifts by company', async () => {
    const shift = { findMany: vi.fn().mockResolvedValue([]) };
    const prisma = { shift } as never;
    await new SchedulingService(prisma, companyWideScopeFilter()).findAll('company-a', {}, 'membership-owner');
    expect(shift.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-a' }) }),
    );
  });

  it('EmployeeService.findAll scopes employees by company', async () => {
    const employee = { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) };
    const prisma = { employee } as never;
    await new EmployeeService(prisma, companyWideScopeFilter()).findAll('company-a', {}, 'membership-owner');
    expect(employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-a' }) }),
    );
  });

  it('LeaveService.getLeaveRequests scopes requests by company', async () => {
    const leaveRequest = { findMany: vi.fn().mockResolvedValue([]) };
    const prisma = { leaveRequest } as never;
    await new LeaveService(prisma, companyWideScopeFilter()).getLeaveRequests('company-a', {}, 'membership-owner');
    expect(leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-a' }) }),
    );
  });

  it('AttendanceService.findDailyRecords scopes records by company', async () => {
    const attendanceRecord = { findMany: vi.fn().mockResolvedValue([]) };
    const prisma = { attendanceRecord } as never;
    await new AttendanceService(prisma, companyWideScopeFilter()).findDailyRecords('company-a', '2026-09-02');
    expect(attendanceRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-a' }) }),
    );
  });

  it('AttendanceService.findEmployeeRecords scopes records by company + employee', async () => {
    const attendanceRecord = { findMany: vi.fn().mockResolvedValue([]) };
    const prisma = { attendanceRecord } as never;
    await new AttendanceService(prisma, companyWideScopeFilter()).findEmployeeRecords('company-a', 'emp-in-company-a');
    expect(attendanceRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-a', employeeId: 'emp-in-company-a' }) }),
    );
  });

  it('OrganizationService.getBranches scopes branches by company', async () => {
    const branch = { findMany: vi.fn().mockResolvedValue([]) };
    const prisma = { branch } as never;
    await new OrganizationService(prisma, companyWideScopeFilter()).getBranches('company-a', 'membership-owner');
    expect(branch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-a' }) }),
    );
  });
});

describe('Tenant isolation — writes reject nodes owned by another company', () => {
  beforeEach(() => vi.clearAllMocks());

  it('EmployeeService.create rejects an employment type from another company', async () => {
    const employee = {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
    };
    const subscription = { findUnique: vi.fn().mockResolvedValue(null) };
    const employmentType = { findFirst: vi.fn().mockResolvedValue(null) };
    const prisma = { employee, subscription, employmentType, branch: { findFirst: vi.fn() }, department: { findFirst: vi.fn() }, team: { findFirst: vi.fn() } } as never;

    await expect(
      new EmployeeService(prisma, companyWideScopeFilter()).create('company-a', {
        employeeNumber: 'E-1',
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.co',
        employmentTypeId: 'et-of-company-b',
        hireDate: '2026-09-02',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(employee.create).not.toHaveBeenCalled();
  });

  it('SchedulingService.create rejects a branch from another company', async () => {
    const branch = { findFirst: vi.fn().mockResolvedValue(null) };
    const prisma = { branch } as never;
    await expect(
      new SchedulingService(prisma, companyWideScopeFilter()).create('company-a', {
        name: 'Night shift',
        startAt: '2026-09-02T20:00:00.000Z',
        endAt: '2026-09-03T04:00:00.000Z',
        branchId: 'branch-of-company-b',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(branch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'branch-of-company-b', companyId: 'company-a' } }),
    );
  });

  it('OrganizationService.createDepartment rejects a branch of another company', async () => {
    const department = { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() };
    const branch = { findFirst: vi.fn().mockResolvedValue(null) };
    const prisma = { department, branch } as never;
    await expect(
      new OrganizationService(prisma, companyWideScopeFilter()).createDepartment('company-a', { branchId: 'branch-of-company-b', name: 'Ops', code: 'OPS' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(department.create).not.toHaveBeenCalled();
  });

  it('OrganizationService.createTeam rejects a department of another company', async () => {
    const team = { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() };
    const department = { findFirst: vi.fn().mockResolvedValue(null) };
    const prisma = { team, department } as never;
    await expect(
      new OrganizationService(prisma, companyWideScopeFilter()).createTeam('company-a', { departmentId: 'dept-of-company-b', name: 'Blue', code: 'BLUE' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(team.create).not.toHaveBeenCalled();
  });
});

describe('Tenant isolation — bulk / background operations stay tenant-scoped', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SchedulingService.publishSchedule refuses to publish another company schedule', async () => {
    const schedule = { findFirst: vi.fn().mockResolvedValue(null) };
    const prisma = { schedule } as never;
    await expect(new SchedulingService(prisma, companyWideScopeFilter()).publishSchedule('company-a', 'schedule-of-company-b', 'u1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(schedule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'schedule-of-company-b', companyId: 'company-a' } }),
    );
  });

  it('SchedulingService.publishSchedule cascades the companyId into the bulk shift update', async () => {
    // When the schedule belongs to the caller, the bulk updateMany must still
    // be constrained to the caller company (belt-and-braces for batch writes).
    const schedule = {
      findFirst: vi.fn().mockResolvedValue({
        id: 'sched-1',
        versions: [],
        shifts: [],
      }),
    };
    const scheduleVersion = { create: vi.fn().mockResolvedValue({}) };
    const scheduleUpdate = { update: vi.fn().mockResolvedValue({}) };
    const shift = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) };
    const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ schedule: scheduleUpdate, scheduleVersion, shift }),
    );
    const prisma = { schedule, shift, $transaction } as never;

    await new SchedulingService(prisma, companyWideScopeFilter()).publishSchedule('company-a', 'sched-1', 'u1');

    expect(shift.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ scheduleId: 'sched-1', companyId: 'company-a' }) }),
    );
  });
});

describe('Tenant isolation — company identity is server-derived, not client-supplied', () => {
  it('CompanyId decorator reads companyId from the authenticated request principal', () => {
    // Apply the decorator the same way Nest does, then invoke the factory it
    // registered with a mocked execution context.
    const Dummy = class {};
    (CompanyId as unknown as (data: unknown) => (target: object, key: string, index: number) => void)('unused')(
      Dummy.prototype,
      'method',
      0,
    );

    const args = Reflect.getMetadata('__routeArguments__', Dummy, 'method') ?? {};
    const entries = Object.values(args as Record<string, { factory?: (data: unknown, ctx: unknown) => unknown }>);
    const factory = entries.find((entry) => typeof entry.factory === 'function')?.factory;
    expect(factory).toBeDefined();

    // The client-supplied companyId in the body is never consulted.
    const request = { user: { companyId: 'company-a' }, body: { companyId: 'company-b' } };
    const ctx = { switchToHttp: () => ({ getRequest: () => request }) };

    expect(factory!('ignored', ctx as never)).toBe('company-a');
  });
});