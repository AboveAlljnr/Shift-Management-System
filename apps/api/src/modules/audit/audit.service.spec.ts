import { describe, it, expect, vi } from 'vitest';

import { AuditService } from './audit.service';

function createMockPrisma() {
  const create = vi.fn();
  const count = vi.fn();
  const findMany = vi.fn();
  // Array form of prisma.$transaction: elements are already-executed promises.
  const $transaction = vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries));

  const prisma = {
    auditLog: { create, count, findMany },
    $transaction,
  };

  return { prisma, create, count, findMany };
}

describe('AuditService', () => {
  it('records an audit log entry with actor and company context', async () => {
    const { prisma, create } = createMockPrisma();
    const created = { id: 'audit-1' };
    create.mockResolvedValue(created);
    const service = new AuditService(prisma);

    const result = await service.record({
      companyId: 'company-1',
      actorId: 'user-1',
      actorEmail: 'a@b.co',
      action: 'auth.logout',
      resource: 'user',
      resourceId: 'user-1',
    });

    expect(result).toBe(created);
    expect(create).toHaveBeenCalledWith({
      data: {
        companyId: 'company-1',
        actorId: 'user-1',
        actorEmail: 'a@b.co',
        action: 'auth.logout',
        resource: 'user',
        resourceId: 'user-1',
        before: undefined,
        after: undefined,
        ipAddress: undefined,
        userAgent: undefined,
        requestId: undefined,
      },
    });
  });

  it('writes null company/actor for platform-level system actions', async () => {
    const { prisma, create } = createMockPrisma();
    create.mockResolvedValue({ id: 'audit-2' });
    const service = new AuditService(prisma);

    await service.record({ action: 'system.maintenance', resource: 'platform' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: null,
          actorId: null,
          action: 'system.maintenance',
          resource: 'platform',
        }),
      }),
    );
  });

  it('queries audit logs scoped to a company with pagination', async () => {
    const { prisma, count, findMany } = createMockPrisma();
    count.mockResolvedValue(1);
    findMany.mockResolvedValue([{ id: 'audit-1' }]);
    const service = new AuditService(prisma);

    const result = await service.findByCompany('company-1', { page: 2, limit: 25 });

    expect(result.total).toBe(1);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(25);
    expect(count).toHaveBeenCalledWith({ where: { companyId: 'company-1' } });
    expect(findMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      orderBy: { occurredAt: 'desc' },
      take: 25,
      skip: 25,
    });
  });
});
