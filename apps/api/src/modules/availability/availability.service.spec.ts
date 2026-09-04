import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ScopeFilterService } from '../authorization/scope-filter.service';

import { AvailabilityService } from './availability.service';

/**
 * Availability module write-path scope + tenant-isolation guarantees (ADR-003).
 * - The TARGET employee must fall inside the caller's effective scope (self for
 *   employees, their branch/department/team for managers).
 * - Company-wide members are unrestricted within the tenant.
 * - other-company employees are unreachable (NotFound).
 * - no duplicate exception per employee+date.
 */

type Granted = { scopeType: 'company' | 'branch' | 'department' | 'team' | 'self'; scopeId: string };

const COMPANY = 'company-a';
const MEMBER = 'member-1';

function scopeFilter(scopes: Granted[]): ScopeFilterService {
  const authorization = {
    getScopes: vi.fn().mockResolvedValue(scopes),
  };
  const sf = new ScopeFilterService(authorization as never);
  // Override resolveScope/employeeWhere via the same bucket logic for readability.
  const resolved = { unrestricted: false, buckets: { branchIds: [], departmentIds: [], teamIds: [], employeeIds: [] } };
  for (const s of scopes) {
    if (s.scopeType === 'company') resolved.unrestricted = true;
    if (s.scopeType === 'branch') resolved.buckets.branchIds.push(s.scopeId);
    if (s.scopeType === 'department') resolved.buckets.departmentIds.push(s.scopeId);
    if (s.scopeType === 'team') resolved.buckets.teamIds.push(s.scopeId);
    if (s.scopeType === 'self') resolved.buckets.employeeIds.push(s.scopeId);
  }
  sf.resolveScope = vi.fn().mockResolvedValue(resolved);
  sf.employeeWhere = vi.fn().mockResolvedValue(undefined);
  return sf;
}

const EMP_SELF: Record<string, unknown> = {
  id: 'emp-1',
  companyId: COMPANY,
  branchId: 'b1',
  departmentId: 'd1',
  teamId: null,
};

const EMP_OTHER_BRANCH: Record<string, unknown> = {
  id: 'emp-2',
  companyId: COMPANY,
  branchId: 'b2',
  departmentId: 'd2',
  teamId: null,
};

type Rule = { id: string; employeeId: string; companyId: string };

function makePrisma(rule: Rule | null = null, exception: { id: string; employeeId: string; companyId: string } | null = null) {
  const employee = {
    findFirst: vi.fn(({ where }: { where: { id?: string; companyId: string } }) => {
      const found = [EMP_SELF, EMP_OTHER_BRANCH].find(
        (e) => e.id === where.id && e.companyId === where.companyId,
      );
      return Promise.resolve(found ?? null);
    }),
  };
  const availabilityRule = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(rule),
    create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'rule-1', ...data })),
    update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
      Promise.resolve({ id: where.id, ...data })),
    delete: vi.fn().mockResolvedValue({}),
  };
  const availabilityException = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(exception),
    create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'exc-1', ...data })),
    update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
      Promise.resolve({ id: where.id, ...data })),
    delete: vi.fn().mockResolvedValue({}),
  };
  const $transaction = vi.fn((fn: (tx: unknown) => unknown) =>
    fn({ availabilityException }),
  );
  return {
    employee,
    availabilityRule,
    availabilityException,
    $transaction,
    prisma: { employee, availabilityRule, availabilityException, $transaction } as never,
  };
}

describe('Availability writes — ADR-003 target scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows a manager (branch scope) to create a rule for an employee in their branch', async () => {
    const { prisma, availabilityRule } = makePrisma();
    const service = new AvailabilityService(prisma, scopeFilter([{ scopeType: 'branch', scopeId: 'b1' }]));

    await service.createRule(COMPANY, { employeeId: 'emp-1', dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-01-01T00:00:00Z' } as never, MEMBER);

    expect(availabilityRule.create).toHaveBeenCalled();
  });

  it('denies creating a rule for an employee in another branch (outside scope)', async () => {
    const { prisma, availabilityRule } = makePrisma();
    const service = new AvailabilityService(prisma, scopeFilter([{ scopeType: 'branch', scopeId: 'b1' }]));

    await expect(
      service.createRule(COMPANY, { employeeId: 'emp-2', dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-01-01T00:00:00Z' } as never, MEMBER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(availabilityRule.create).not.toHaveBeenCalled();
  });

  it('allows employees to manage their own availability (self scope)', async () => {
    const { prisma, availabilityRule } = makePrisma();
    const service = new AvailabilityService(prisma, scopeFilter([{ scopeType: 'self', scopeId: 'emp-1' }]));

    await service.createRule(COMPANY, { employeeId: 'emp-1', dayOfWeek: 2, startTime: '08:00', endTime: '12:00', effectiveFrom: '2026-01-01T00:00:00Z' } as never, MEMBER);
    expect(availabilityRule.create).toHaveBeenCalled();
  });

  it('denies an employee managing a colleague availability (self scope ≠ target)', async () => {
    const { prisma, availabilityRule } = makePrisma();
    const service = new AvailabilityService(prisma, scopeFilter([{ scopeType: 'self', scopeId: 'emp-1' }]));

    await expect(
      service.createRule(COMPANY, { employeeId: 'emp-2', dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-01-01T00:00:00Z' } as never, MEMBER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(availabilityRule.create).not.toHaveBeenCalled();
  });

  it('grant-less member is denied (deny by default)', async () => {
    const { prisma, availabilityRule } = makePrisma();
    const service = new AvailabilityService(prisma, scopeFilter([]));

    await expect(
      service.createRule(COMPANY, { employeeId: 'emp-1', dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-01-01T00:00:00Z' } as never, MEMBER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(availabilityRule.create).not.toHaveBeenCalled();
  });

  it('company-wide scope creates rules for any employee', async () => {
    const { prisma, availabilityRule } = makePrisma();
    const service = new AvailabilityService(prisma, scopeFilter([{ scopeType: 'company', scopeId: COMPANY }]));

    await service.createRule(COMPANY, { employeeId: 'emp-2', dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-01-01T00:00:00Z' } as never, MEMBER);
    expect(availabilityRule.create).toHaveBeenCalled();
  });

  it('rejects an available window where startTime >= endTime', async () => {
    const { prisma, availabilityRule } = makePrisma();
    const service = new AvailabilityService(prisma, scopeFilter([{ scopeType: 'company', scopeId: COMPANY }]));

    await expect(
      service.createRule(COMPANY, { employeeId: 'emp-1', dayOfWeek: 1, isAvailable: true, startTime: '17:00', endTime: '09:00', effectiveFrom: '2026-01-01T00:00:00Z' } as never, MEMBER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(availabilityRule.create).not.toHaveBeenCalled();
  });

  it('other-company employee is unreachable (tenant isolation, NotFound)', async () => {
    // Mock employee lookup to return null (simulates an employee not in this tenant).
    const { prisma, availabilityRule } = makePrisma();
    const prisma2 = {
      ...prisma,
      employee: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never;
    const service = new AvailabilityService(prisma2, scopeFilter([{ scopeType: 'company', scopeId: COMPANY }]));

    await expect(
      service.createRule(COMPANY, { employeeId: 'emp-of-company-b', dayOfWeek: 1, startTime: '09:00', endTime: '17:00', effectiveFrom: '2026-01-01T00:00:00Z' } as never, MEMBER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(availabilityRule.create).not.toHaveBeenCalled();
  });
});

describe('Availability exceptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects duplicate exception for the same employee+date', async () => {
    const existing = { id: 'exc-1', employeeId: 'emp-1', companyId: COMPANY };
    const { prisma, availabilityException } = makePrisma(null, existing);
    const service = new AvailabilityService(prisma, scopeFilter([{ scopeType: 'company', scopeId: COMPANY }]));

    await expect(
      service.createException(COMPANY, { employeeId: 'emp-1', date: '2026-09-15T00:00:00Z' } as never, MEMBER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(availabilityException.create).not.toHaveBeenCalled();
  });

  it('creates an exception when none exists for that date', async () => {
    const { prisma, availabilityException } = makePrisma();
    const service = new AvailabilityService(prisma, scopeFilter([{ scopeType: 'company', scopeId: COMPANY }]));

    await service.createException(COMPANY, { employeeId: 'emp-1', date: '2026-09-15T00:00:00Z', reason: 'Appointment' } as never, MEMBER);
    expect(availabilityException.create).toHaveBeenCalled();
  });
});

describe('Availability deletes — target scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows deleting a rule whose owner is in scope', async () => {
    const rule = { id: 'rule-1', employeeId: 'emp-1', companyId: COMPANY };
    const { prisma, availabilityRule } = makePrisma(rule);
    const service = new AvailabilityService(prisma, scopeFilter([{ scopeType: 'branch', scopeId: 'b1' }]));

    await service.deleteRule(COMPANY, 'rule-1', MEMBER);
    expect(availabilityRule.delete).toHaveBeenCalledWith({ where: { id: 'rule-1' } });
  });

  it('denies deleting a rule whose owner is outside scope', async () => {
    const rule = { id: 'rule-1', employeeId: 'emp-2', companyId: COMPANY };
    const { prisma, availabilityRule } = makePrisma(rule);
    const service = new AvailabilityService(prisma, scopeFilter([{ scopeType: 'branch', scopeId: 'b1' }]));

    await expect(service.deleteRule(COMPANY, 'rule-1', MEMBER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(availabilityRule.delete).not.toHaveBeenCalled();
  });

  it('denies deleting an unknown rule (NotFound)', async () => {
    const { prisma, availabilityRule } = makePrisma();
    const service = new AvailabilityService(prisma, scopeFilter([{ scopeType: 'company', scopeId: COMPANY }]));

    await expect(service.deleteRule(COMPANY, 'missing', MEMBER)).rejects.toBeInstanceOf(NotFoundException);
    expect(availabilityRule.delete).not.toHaveBeenCalled();
  });
});
