import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ScopeFilterService } from '../authorization/scope-filter.service';

import { EmployeeService } from './employee.service';

/**
 * ADR-003 WRITE-path scope enforcement for EmployeeService. The read path
 * (list/detail) is covered in query-scope.spec; these focus on create/update/
 * deactivate: the TARGET placement must be inside the caller's effective b
 * scope, and an org-field move needs BOTH ends in scope.
 */

type Granted = { scopeType: 'company' | 'branch' | 'department' | 'team' | 'self'; scopeId: string };

const COMPANY = 'company-a';
const MEMBER = 'member-1';

function scopeFilterGranting(scopes: Granted[]): ScopeFilterService {
  const authorization = {
    getScopes: vi.fn().mockResolvedValue(scopes),
  };
  return new ScopeFilterService(authorization as never);
}

interface MockEmployee {
  id: string;
  companyId: string;
  branchId: string | null;
  departmentId: string | null;
  teamId: string | null;
}

function createPrisma(options: { employees?: MockEmployee[]; existingNumbers?: string[] } = {}) {
  const employees = options.employees ?? [];
  const employee = {
    findUnique: vi.fn(({ where }: { where: { companyId_employeeNumber?: { companyId: string; employeeNumber: string } } }) => {
      const key = where.companyId_employeeNumber;
      if (key && options.existingNumbers?.includes(key.employeeNumber)) {
        return Promise.resolve({ id: 'other' });
      }
      return Promise.resolve(null);
    }),
    count: vi.fn().mockResolvedValue(0),
    findFirst: vi.fn(({ where }: { where: { id?: string; companyId: string } }) => {
      const found = employees.find((e) => e.id === where.id && e.companyId === where.companyId);
      return Promise.resolve(found ?? null);
    }),
    create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'new-emp', ...data })),
    update: vi.fn(({ data, where }: { where: { id: string }; data: Record<string, unknown> }) =>
      Promise.resolve({ id: where.id, ...data }),
    ),
  };

  const employmentType = { findFirst: vi.fn().mockResolvedValue({ id: 'et-1' }) };
  const branch = { findFirst: vi.fn().mockResolvedValue({ id: 'b-x' }) };
  const department = { findFirst: vi.fn().mockResolvedValue({ id: 'd-x' }) };
  const team = { findFirst: vi.fn().mockResolvedValue({ id: 't-x' }) };
  const subscription = { findUnique: vi.fn().mockResolvedValue(null) };

  return {
    employee,
    employmentType,
    branch,
    department,
    team,
    subscription,
    prisma: { employee, employmentType, branch, department, team, subscription } as never,
  };
}

const EMP_B1: MockEmployee = {
  id: 'emp-b1',
  companyId: COMPANY,
  branchId: 'b1',
  departmentId: 'd1',
  teamId: null,
};

const EMP_B2: MockEmployee = {
  id: 'emp-b2',
  companyId: COMPANY,
  branchId: 'b2',
  departmentId: 'd2',
  teamId: null,
};

describe('Employee writes — ADR-003 target scope (update)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows a same-branch update by a branch-scoped member', async () => {
    const { prisma, employee } = createPrisma({ employees: [EMP_B1] });
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await service.update(COMPANY, 'emp-b1', { phone: '111' }, MEMBER);

    expect(employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'emp-b1' },
        data: expect.objectContaining({ phone: '111' }),
      }),
    );
  });

  it('parent scope (branch) may update a descendant employee in the branch', async () => {
    const { prisma, employee } = createPrisma({ employees: [EMP_B1] });
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await service.update(COMPANY, 'emp-b1', { lastName: 'Updated' }, MEMBER);

    expect(employee.update).toHaveBeenCalled();
  });

  it('sibling employee update is denied (branch b1 scope vs employee in b2)', async () => {
    const { prisma, employee } = createPrisma({ employees: [EMP_B2] });
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await expect(service.update(COMPANY, 'emp-b2', { phone: '111' }, MEMBER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(employee.update).not.toHaveBeenCalled();
  });

  it('parent employee update is denied from a child (team) scope', async () => {
    // A team-scoped member tries to update a PARENT/ancestor record: an
    // employee placed at the branch level (no team) is NOT inside the team
    // scope, so the write is denied (scope is downward-only).
    const parentEmployee = { ...EMP_B1, teamId: null };
    const { prisma, employee } = createPrisma({ employees: [parentEmployee] });
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'team', scopeId: 't1' }]));

    await expect(service.update(COMPANY, 'emp-b1', { phone: '111' }, MEMBER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(employee.update).not.toHaveBeenCalled();
  });

  it('other-company employee update is denied (tenant isolation, NOT_FOUND)', async () => {
    const { prisma, employee } = createPrisma();
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'company', scopeId: COMPANY }]));

    await expect(service.update(COMPANY, 'emp-of-company-b', { phone: '111' }, MEMBER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(employee.update).not.toHaveBeenCalled();
  });

  it('manipulated IDs are denied: an out-of-scope id cannot be updated', async () => {
    const { prisma, employee } = createPrisma({ employees: [EMP_B2] });
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await expect(service.update(COMPANY, 'emp-b2', { phone: '111' }, MEMBER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(employee.update).not.toHaveBeenCalled();
  });

  it('manipulated organization fields cannot widen scope (move to b2 denied)', async () => {
    const { prisma, employee } = createPrisma({ employees: [EMP_B1] });
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    // Current placement in scope (b1); resulting placement b2 out of scope.
    await expect(service.update(COMPANY, 'emp-b1', { branchId: 'b2' }, MEMBER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(employee.update).not.toHaveBeenCalled();
  });

  it('allows a within-scope relocation (b1 dept d1 -> b1 dept d9)', async () => {
    const { prisma, employee } = createPrisma({ employees: [EMP_B1] });
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await service.update(COMPANY, 'emp-b1', { departmentId: 'd9' }, MEMBER);

    expect(employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ departmentId: 'd9' }) }),
    );
  });

  it('self-scope permits updating only the members own record', async () => {
    const { prisma, employee } = createPrisma({ employees: [EMP_B1] });
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'self', scopeId: 'emp-b1' }]));

    await service.update(COMPANY, 'emp-b1', { phone: '111' }, MEMBER);
    expect(employee.update).toHaveBeenCalled();
  });

  it('self-scope cannot update a colleagues record even inside the branch', async () => {
    const { prisma, employee } = createPrisma({ employees: [EMP_B1] });
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'self', scopeId: 'some-other-self' }]));

    await expect(service.update(COMPANY, 'emp-b1', { phone: '111' }, MEMBER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(employee.update).not.toHaveBeenCalled();
  });

  it('manipulated cross-company org node on update does not widen scope (denied for scoped member)', async () => {
    const { prisma, employee } = createPrisma({ employees: [EMP_B1] });
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    // The resulting placement (branchId = another company branch) is outside
    // the caller scope -> FORBIDDEN fires before any node lookups.
    await expect(
      service.update(COMPANY, 'emp-b1', { branchId: 'branch-of-company-b' }, MEMBER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(employee.update).not.toHaveBeenCalled();
  });

  it('tenant-FK parity on update: cross-company org node rejected for unrestricted member', async () => {
    const { prisma, employee } = createPrisma({ employees: [EMP_B1] });
    const branch = { findFirst: vi.fn().mockResolvedValue(null) };
    const prisma2 = { ...prisma, branch } as never;
    const service = new EmployeeService(prisma2, scopeFilterGranting([{ scopeType: 'company', scopeId: COMPANY }]));

    await expect(
      service.update(COMPANY, 'emp-b1', { branchId: 'branch-of-company-b' }, MEMBER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(employee.update).not.toHaveBeenCalled();
  });
});

describe('Employee writes — ADR-003 target scope (deactivate)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows deactivating an employee inside the caller scope', async () => {
    const { prisma, employee } = createPrisma({ employees: [EMP_B1] });
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await service.deactivate(COMPANY, 'emp-b1', MEMBER);

    expect(employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'emp-b1' }, data: expect.objectContaining({ status: 'inactive' }) }),
    );
  });

  it('deactivate is denied outside scope', async () => {
    const { prisma, employee } = createPrisma({ employees: [EMP_B2] });
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await expect(service.deactivate(COMPANY, 'emp-b2', MEMBER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(employee.update).not.toHaveBeenCalled();
  });

  it('deactivate of another-company employee is denied (tenant isolation)', async () => {
    const { prisma, employee } = createPrisma();
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'company', scopeId: COMPANY }]));

    await expect(service.deactivate(COMPANY, 'emp-of-company-b', MEMBER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(employee.update).not.toHaveBeenCalled();
  });

  it('company-wide scope deactivates across branches', async () => {
    const { prisma, employee } = createPrisma({ employees: [EMP_B2] });
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'company', scopeId: COMPANY }]));

    await service.deactivate(COMPANY, 'emp-b2', MEMBER);
    expect(employee.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'emp-b2' } }));
  });
});

describe('Employee writes — ADR-003 create placement', () => {
  beforeEach(() => vi.clearAllMocks());

  const baseDto = {
    employeeNumber: 'E-9',
    firstName: 'A',
    lastName: 'B',
    email: 'a@b.co',
    employmentTypeId: 'et-1',
    hireDate: '2026-09-02',
  };

  it('branch-scoped member can create an employee in their own branch', async () => {
    const { prisma, employee } = createPrisma();
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await service.create(COMPANY, { ...baseDto, branchId: 'b1' } as never, MEMBER);

    expect(employee.create).toHaveBeenCalled();
  });

  it('branch-scoped member cannot create an employee in another branch', async () => {
    const { prisma, employee } = createPrisma();
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await expect(service.create(COMPANY, { ...baseDto, branchId: 'b2' } as never, MEMBER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(employee.create).not.toHaveBeenCalled();
  });

  it('branchless placement is unreachable from a branch scope (company root only)', async () => {
    const { prisma, employee } = createPrisma();
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'branch', scopeId: 'b1' }]));

    await expect(service.create(COMPANY, baseDto as never, MEMBER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(employee.create).not.toHaveBeenCalled();
  });

  it('grant-less member cannot create (deny by default)', async () => {
    const { prisma, employee } = createPrisma();
    const service = new EmployeeService(prisma, scopeFilterGranting([]));

    await expect(service.create(COMPANY, { ...baseDto, branchId: 'b1' } as never, MEMBER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(employee.create).not.toHaveBeenCalled();
  });

  it('company-wide scope creates across branches and branchless', async () => {
    const { prisma, employee } = createPrisma();
    const service = new EmployeeService(prisma, scopeFilterGranting([{ scopeType: 'company', scopeId: COMPANY }]));

    await service.create(COMPANY, baseDto as never, MEMBER);
    expect(employee.create).toHaveBeenCalled();

    employee.create.mockClear();
    await service.create(COMPANY, { ...baseDto, branchId: 'b2' } as never, MEMBER);
    expect(employee.create).toHaveBeenCalled();
  });
});