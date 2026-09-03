import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ROLE_PERMISSION_TEMPLATES } from '@sms/shared';
import bcrypt from 'bcrypt';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AuthService } from './auth.service';

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(async () => 'hashed'),
    compare: vi.fn(async () => true),
  },
  hash: vi.fn(async () => 'hashed'),
  compare: vi.fn(async () => true),
}));

function createPrismaMock() {
  const user = {
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const refreshToken = {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  };
  const companyMembership = { findUnique: vi.fn() };
  const company = { findUnique: vi.fn() };
  const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn({} as any),
  );
  return { prisma: { user, refreshToken, companyMembership, company, $transaction }, user, refreshToken };
}

function createDeps() {
  const { prisma, user, refreshToken } = createPrismaMock();
  const jwtService = {
    sign: vi.fn((_p: unknown) => 'signed-access-token'),
  };
  const configService = {
    get: vi.fn((_key: string, fallback?: string) => fallback),
  };
  const audit = {
    record: vi.fn(async () => ({})),
  };
  const service = new AuthService(prisma, jwtService, configService, audit);
  return { service, prisma, user, refreshToken, jwtService, configService, audit };
}

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bcrypt.compare as any).mockResolvedValue(true);
  });

  it('records an audit failure and rejects unknown credentials', async () => {
    const { service, user, audit } = createDeps();
    user.findUnique.mockResolvedValue(null);

    await expect(service.login({ email: 'missing@x.com', password: 'pw' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login.failure' }),
    );
  });

  it('rejects suspended accounts', async () => {
    const { service, user } = createDeps();
    user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.co',
      passwordHash: 'hashed',
      status: 'suspended',
      memberships: [],
    });

    await expect(service.login({ email: 'a@b.co', password: 'pw' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('logs in successfully, updates last login, issues tokens and audits', async () => {
    const { service, user, refreshToken, jwtService, configService, audit } = createDeps();

    user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.co',
      passwordHash: 'hashed',
      status: 'active',
      memberships: [
        {
          id: 'm1',
          status: 'active',
          companyId: 'c1',
          company: { slug: 'acme' },
          roles: [{ role: { code: 'OWNER' } }],
        },
      ],
    });
    // audit.record on the login-success path returns a promise; keep it failing-free
    audit.record.mockResolvedValue({});
    user.update.mockResolvedValue({});
    refreshToken.create.mockResolvedValue({});
    configService.get.mockImplementation((_k: string, fallback?: string) => fallback);

    const result = await service.login({ email: 'a@b.co', password: 'pw' });

    expect(user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { lastLoginAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith({
      companyId: 'c1',
      actorId: 'u1',
      actorEmail: 'a@b.co',
      action: 'auth.login.success',
      resource: 'user',
      resourceId: 'u1',
    });
    expect(jwtService.sign).toHaveBeenCalled();
    expect(result.accessToken).toBe('signed-access-token');
    expect(result.expiresIn).toBe(900);
  });

  it('audits logout after revoking the refresh token', async () => {
    const { service, refreshToken, audit } = createDeps();
    refreshToken.updateMany.mockResolvedValue({ count: 1 });
    refreshToken.findUnique.mockResolvedValue({
      userId: 'u1',
      membershipId: 'm1',
    });
    service['prisma'].user.findUnique.mockResolvedValue({ email: 'a@b.co' });
    service['prisma'].companyMembership.findUnique.mockResolvedValue({ companyId: 'c1' });

    await service.logout('some-token');

    expect(refreshToken.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: expect.any(String) },
      data: { isRevoked: true },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.logout', companyId: 'c1' }),
    );
  });
});

describe('AuthService — register', () => {
  beforeEach(() => vi.clearAllMocks());

  function createRegisterDeps() {
    const jwtService = { sign: vi.fn(() => 'signed-access-token') };
    const configService = { get: vi.fn((_k: string, fallback?: string) => fallback) };
    const audit = { record: vi.fn(async () => ({})) };
    const refreshToken = { create: vi.fn().mockResolvedValue({}) };
    const permission = { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]) };
    const rolePermission = { createMany: vi.fn().mockResolvedValue({ count: 2 }) };

    const tx = {
      company: {
        create: vi.fn().mockResolvedValue({ id: 'c1' }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'u1' }),
      },
      companyMembership: {
        create: vi.fn().mockResolvedValue({ id: 'm1' }),
      },
      role: {
        create: vi.fn().mockResolvedValue({ id: 'r1', code: 'OWNER' }),
      },
      permission,
      rolePermission,
      userRole: { create: vi.fn().mockResolvedValue({}) },
      accessScope: { create: vi.fn().mockResolvedValue({}) },
      branch: { create: vi.fn().mockResolvedValue({ id: 'b1' }) },
      employmentType: { create: vi.fn().mockResolvedValue({ id: 'et1' }) },
      employee: { create: vi.fn().mockResolvedValue({}) },
    };

    const prisma = {
      company: { findUnique: vi.fn().mockResolvedValue(null) },
      refreshToken,
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    };

    const service = new AuthService(prisma as never, jwtService as never, configService as never, audit as never);
    return { service, tx, refreshToken, permission, rolePermission, jwtService, configService };
  }

  it('bootstraps the Owner membership with a company-wide scope and the full Owner permission set', async () => {
    const { service, tx, rolePermission } = createRegisterDeps();

    const result = await service.register({
      companyName: 'Acme',
      companySlug: 'acme',
      email: 'owner@acme.co',
      password: 'secret123',
      name: 'Owner',
      timezone: 'UTC',
    });

    // Owner grants are wired to the canonical template inside the transaction
    expect(rowRoleCreate(tx)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ code: 'OWNER', isSystemRole: true }),
      }),
    );
    expect(rolePermission.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        { roleId: 'r1', permissionId: 'p1' },
        { roleId: 'r1', permissionId: 'p2' },
      ]),
      skipDuplicates: true,
    });

    // Owner receives a company-wide AccessScope (docs/03-auth/scopes.md)
    expect(tx.accessScope.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scopeType: 'company', scopeId: 'c1' }),
      }),
    );

    expect(result.accessToken).toBe('signed-access-token');
    expect(result.expiresIn).toBe(900);
  });

  it('requests precisely the canonical Owner action set from the catalog', async () => {
    const { service, permission } = createRegisterDeps();

    await service.register({
      companyName: 'Acme',
      companySlug: 'acme',
      email: 'owner@acme.co',
      password: 'secret123',
      name: 'Owner',
    });

    const ownerActions = ROLE_PERMISSION_TEMPLATES.OWNER;
    expect(permission.findMany).toHaveBeenCalledWith({
      where: { action: { in: [...ownerActions] } },
      select: { id: true },
    });
  });
});

function rowRoleCreate(tx: { role: { create: ReturnType<typeof vi.fn> } }) {
  return tx.role.create.mock.calls[0][0];
}
