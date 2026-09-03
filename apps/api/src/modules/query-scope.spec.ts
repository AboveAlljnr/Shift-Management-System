import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

import { AttendanceService } from './attendance/attendance.service';
import { ScopeFilterService } from './authorization/scope-filter.service';
import { EmployeeService } from './employee/employee.service';
import { LeaveService } from './leave/leave.service';
import { OrganizationService } from './organization/organization.service';
import { SchedulingService } from './scheduling/scheduling.service';

type Granted = { scopeType: 'company' | 'branch' | 'department' | 'team' | 'self'; scopeId: string };

const COMPANY = 'company-a';
const MEMBER = 'member-1';

function scopeFilterGranting(scopes: Granted[]): ScopeFilterService {
  const authorization = {
    getScopes: vi.fn().mockResolvedValue(scopes),
  };
  return new ScopeFilterService(authorization as never);
}

function createPrisma() {
  const employee = {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    findFirst: vi.fn().mockResolvedValue(null),
  };
  const shift = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
  };
  const attendanceRecord = { findMany: vi.fn().mockResolvedValue([]) };
  const leaveRequest = { findMany: vi.fn().mockResolvedValue([]) };
  const leaveBalance = { findMany: vi.fn().mockResolvedValue([]) };
  const branch = { findMany: vi.fn().mockResolvedValue([]) };
  const department = { findMany: vi.fn().mockResolvedValue([]) };
  const team = { findMany: vi.fn().mockResolvedValue([]) };
  const position = { findMany: vi.fn().mockResolvedValue([]) };
  return {
    employee,
    shift,
    attendanceRecord,
    leaveRequest,
    leaveBalance,
    branch,
    department,
    team,
    position,
    prisma: {
      employee,
      shift,
      attendanceRecord,
      leaveRequest,
      leaveBalance,
      branch,
      department,
      team,
      position,
    } as never,
  };
}

describe('Employees — ADR-003 query scope', () => {
  it('company-wide scope adds no filter; list and count share the same scoped where', async () => {
    const { prisma, employee } = createPrisma();
    const service = new EmployeeService(
      prisma,
      scopeFilterGranting([{ scopeType: 'company', scopeId: COMPANY }]),
    );

    await service.findAll(COMPANY, {}, MEMBER);

    const rowsWhere = employee.findMany.mock.calls[0][0].where;
    const countWhere = employee.count.mock.calls[0][0].where;
    expect(rowsWhere).toEqual({ companyId: COMPANY });
    expect(countWhere).toEqual(rowsWhere);
  });

  it('branch-scope constrains the list AND the count (filtering precedes pagination)', async () => {
    const { prisma, employee } = createPrisma();
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await service.findAll(COMPANY, {}, MEMBER);

    const rowsWhere = employee.findMany.mock.calls[0][0].where;
    const countWhere = employee.count.mock.calls[0][0].where;
    expect(rowsWhere.AND).toEqual([{ OR: [{ branchId: { in: ['b1'] } }] }]);
    expect(countWhere).toEqual(rowsWhere);
  });

  it('department, team and self grants produce their own OR clauses', async () => {
    const { prisma, employee } = createPrisma();

    await new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'department', scopeId: 'd1' }]))
      .findAll(COMPANY, {}, MEMBER);
    expect(employee.findMany.mock.calls[0][0].where.AND).toEqual([
      { OR: [{ departmentId: { in: ['d1'] } }] },
    ]);

    await new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'team', scopeId: 't1' }]))
      .findAll(COMPANY, {}, MEMBER);
    expect(employee.findMany.mock.calls[1][0].where.AND).toEqual([
      { OR: [{ teamId: { in: ['t1'] } }] },
    ]);

    await new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'self', scopeId: 'e1' }]))
      .findAll(COMPANY, {}, MEMBER);
    expect(employee.findMany.mock.calls[2][0].where.AND).toEqual([
      { OR: [{ id: { in: ['e1'] } }] },
    ]);
  });

  it('grant-less member gets a match-nothing predicate (deny by default)', async () => {
    const { prisma, employee } = createPrisma();
    const service = new EmployeeService(prisma, scopeFilterGranting([]));

    await service.findAll(COMPANY, {}, MEMBER);

    expect(employee.findMany.mock.calls[0][0].where.AND).toEqual([{ OR: [{ id: { in: [] } }] }]);
  });

  it('out-of-scope findById returns NOT_FOUND', async () => {
    const { prisma, employee } = createPrisma();
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await expect(service.findById(COMPANY, 'emp-of-b2', MEMBER)).rejects.toBeInstanceOf(NotFoundException);

    expect(employee.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'emp-of-b2',
          companyId: COMPANY,
          AND: [{ OR: [{ branchId: { in: ['b1'] } }] }],
        }),
      }),
    );
  });

  it('search OR and scope AND compose (search cannot widen scope)', async () => {
    const { prisma, employee } = createPrisma();
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await service.findAll(COMPANY, { search: 'jane' } as never, MEMBER);

    const where = employee.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([{ OR: [{ branchId: { in: ['b1'] } }] }]);
    expect(where.OR).toEqual([
      { firstName: { contains: 'jane', mode: 'insensitive' } },
      { lastName: { contains: 'jane', mode: 'insensitive' } },
      { email: { contains: 'jane', mode: 'insensitive' } },
      { employeeNumber: { contains: 'jane', mode: 'insensitive' } },
    ]);
  });
});

describe('Shifts — ADR-003 query scope', () => {
  it('branch-scope constrains shifts and their included assignments', async () => {
    const { prisma, shift } = createPrisma();
    const service = new SchedulingService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await service.findAll(COMPANY, {}, MEMBER);

    const findMany = shift.findMany.mock.calls[0][0];
    expect(findMany.where.AND).toEqual([{ OR: [{ branchId: { in: ['b1'] } }] }]);
    expect(findMany.include.assignments).toEqual({
      where: { employee: { OR: [{ branchId: { in: ['b1'] } }] } },
      include: { employee: true },
    });
  });

  it('self-scope surfaces only the member own assignments via `assignments.some`', async () => {
    const { prisma, shift } = createPrisma();
    const service = new SchedulingService(prisma, scopeFilterGranting([{ scopeType: 'self', scopeId: 'e1' }]));

    await service.findAll(COMPANY, {}, MEMBER);

    const findMany = shift.findMany.mock.calls[0][0];
    expect(findMany.where.AND).toEqual([
      { OR: [{ assignments: { some: { employeeId: { in: ['e1'] } } } }] },
    ]);
    expect(findMany.include.assignments).toEqual({
      where: { employee: { OR: [{ id: { in: ['e1'] } }] } },
      include: { employee: true },
    });
  });

  it('client-supplied branchId composes AND-wise and cannot widen scope', async () => {
    const { prisma, shift } = createPrisma();
    const service = new SchedulingService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await service.findAll(COMPANY, { branchId: 'b2' }, MEMBER);

    const where = shift.findMany.mock.calls[0][0].where;
    expect(where.branchId).toBe('b2');
    expect(where.AND).toEqual([{ OR: [{ branchId: { in: ['b1'] } }] }]);
  });

  it('out-of-scope shift findById returns NOT_FOUND', async () => {
    const { prisma, shift } = createPrisma();
    const service = new SchedulingService(prisma, scopeFilterGranting([{ scopeType: 'department', scopeId: 'd1' }]));

    await expect(service.findById(COMPANY, 'shift-of-d2', MEMBER)).rejects.toBeInstanceOf(NotFoundException);

    expect(shift.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AND: [{ OR: [{ departmentId: { in: ['d1'] } }] }] }),
      }),
    );
  });
});

describe('Attendance — ADR-003 query scope', () => {
  it('daily overview ANDs the requested branch with the caller branch scope', async () => {
    const { prisma, attendanceRecord } = createPrisma();
    const service = new AttendanceService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await service.findDailyRecords(COMPANY, '2026-09-02', 'b2', MEMBER);

    const where = attendanceRecord.findMany.mock.calls[0][0].where;
    expect(where.companyId).toBe(COMPANY);
    expect(where.employee).toEqual({
      branchId: 'b2',
      OR: [{ branchId: { in: ['b1'] } }],
    });
  });

  it('self scope hides other employees attendance via the relation filter', async () => {
    const { prisma, attendanceRecord } = createPrisma();
    const service = new AttendanceService(prisma, scopeFilterGranting([{ scopeType: 'self', scopeId: 'e1' }]));

    await service.findEmployeeRecords(COMPANY, 'colleague-id', '2026-01-01', '2026-12-31', MEMBER);

    const where = attendanceRecord.findMany.mock.calls[0][0].where;
    expect(where.employeeId).toBe('colleague-id');
    expect(where.employee).toEqual({ OR: [{ id: { in: ['e1'] } }] });
  });
});

describe('Leave — ADR-003 query scope', () => {
  it('request list ANDs scope with any employeeId filter', async () => {
    const { prisma, leaveRequest } = createPrisma();
    const service = new LeaveService(prisma, scopeFilterGranting([{ scopeType: 'department', scopeId: 'd1' }]));

    await service.getLeaveRequests(COMPANY, { employeeId: 'e9', status: 'pending' }, MEMBER);

    const where = leaveRequest.findMany.mock.calls[0][0].where;
    expect(where.employeeId).toBe('e9');
    expect(where.employee).toEqual({ OR: [{ departmentId: { in: ['d1'] } }] });
  });

  it('balances of another employee are unreachable under a branch scope', async () => {
    const { prisma, leaveBalance } = createPrisma();
    const service = new LeaveService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await service.getBalances(COMPANY, 'e9', 2026, MEMBER);

    const where = leaveBalance.findMany.mock.calls[0][0].where;
    expect(where.employeeId).toBe('e9');
    expect(where.employee).toEqual({ OR: [{ branchId: { in: ['b1'] } }] });
  });
});

describe('Organization — ADR-003 query scope (ancestors are never reachable)', () => {
  it('branch list under a department scope is empty (branch is an ancestor)', async () => {
    const { prisma, branch } = createPrisma();
    const service = new OrganizationService(prisma, scopeFilterGranting([{ scopeType: 'department', scopeId: 'd1' }]));

    await service.getBranches(COMPANY, MEMBER);

    expect(branch.findMany.mock.calls[0][0].where.AND).toEqual([{ OR: [{ id: { in: [] } }] }]);
  });

  it('branch list under a branch scope returns only granted branches', async () => {
    const { prisma, branch } = createPrisma();
    const service = new OrganizationService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await service.getBranches(COMPANY, MEMBER);

    expect(branch.findMany.mock.calls[0][0].where.AND).toEqual([{ OR: [{ id: { in: ['b1'] } }] }]);
  });

  it('departments: branch scope exposes branch departments, team scope exposes none', async () => {
    const { prisma, department } = createPrisma();
    const branchService = new OrganizationService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));
    await branchService.getDepartments(COMPANY, undefined, MEMBER);
    expect(department.findMany.mock.calls[0][0].where.AND).toEqual([
      { OR: [{ branchId: { in: ['b1'] } }] },
    ]);

    const teamService = new OrganizationService(prisma, scopeFilterGranting([{ scopeType: 'team', scopeId: 't1' }]));
    await teamService.getDepartments(COMPANY, undefined, MEMBER);
    expect(department.findMany.mock.calls[1][0].where.AND).toEqual([{ OR: [{ id: { in: [] } }] }]);
  });

  it('teams: branch/department/team grants climb the ancestry once', async () => {
    const { prisma, team } = createPrisma();

    await new OrganizationService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]))
      .getTeams(COMPANY, undefined, MEMBER);
    expect(team.findMany.mock.calls[0][0].where.AND).toEqual([
      { OR: [{ department: { branchId: { in: ['b1'] } } }] },
    ]);

    await new OrganizationService(prisma, scopeFilterGranting([{ scopeType: 'department', scopeId: 'd1' }]))
      .getTeams(COMPANY, undefined, MEMBER);
    expect(team.findMany.mock.calls[1][0].where.AND).toEqual([
      { OR: [{ departmentId: { in: ['d1'] } }] },
    ]);

    await new OrganizationService(prisma, scopeFilterGranting([{ scopeType: 'team', scopeId: 't1' }]))
      .getTeams(COMPANY, undefined, MEMBER);
    expect(team.findMany.mock.calls[2][0].where.AND).toEqual([{ OR: [{ id: { in: ['t1'] } }] }]);
  });

  it('positions: only positions inside granted departments/branches are reachable', async () => {
    const { prisma, position } = createPrisma();
    const branchService = new OrganizationService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));
    await branchService.getPositions(COMPANY, MEMBER);
    expect(position.findMany.mock.calls[0][0].where.AND).toEqual([
      { OR: [{ department: { branchId: { in: ['b1'] } } }] },
    ]);

    const deptService = new OrganizationService(prisma, scopeFilterGranting([{ scopeType: 'department', scopeId: 'd1' }]));
    await deptService.getPositions(COMPANY, MEMBER);
    expect(position.findMany.mock.calls[1][0].where.AND).toEqual([
      { OR: [{ departmentId: { in: ['d1'] } }] },
    ]);
  });
});