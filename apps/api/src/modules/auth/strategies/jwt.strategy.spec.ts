import { UnauthorizedException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

import { JwtStrategy } from './jwt.strategy';

function createConfig() {
  return {
    get: vi.fn((key: string, fallback?: string) => {
      // The strategy requires an explicit JWT_ACCESS_SECRET (never a hidden fallback).
      if (key === 'JWT_ACCESS_SECRET') return 'test-access-secret';
      return fallback;
    }),
  };
}

function createPrisma() {
  const findUnique = vi.fn();
  const prisma = {
    companyMembership: { findUnique },
  };
  return { prisma, findUnique };
}

describe('JwtStrategy', () => {
  const payload = {
    sub: 'user-1',
    email: 'a@b.co',
    companyId: 'company-1',
    membershipId: 'membership-1',
    roles: ['admin'],
  };

  it('accepts a token with an active matching membership (ADR-004)', async () => {
    const config = createConfig();
    const { prisma, findUnique } = createPrisma();
    findUnique.mockResolvedValue({
      id: 'membership-1',
      userId: 'user-1',
      companyId: 'company-1',
      status: 'active',
    });
    const strategy = new JwtStrategy(config, prisma);

    const result = await strategy.validate(payload);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'membership-1' },
      select: { id: true, userId: true, companyId: true, status: true },
    });
    expect(result).toEqual({
      id: 'user-1',
      email: 'a@b.co',
      companyId: 'company-1',
      membershipId: 'membership-1',
      roles: ['admin'],
    });
  });

  it('rejects a token whose membership no longer exists', async () => {
    const config = createConfig();
    const { prisma, findUnique } = createPrisma();
    findUnique.mockResolvedValue(null);
    const strategy = new JwtStrategy(config, prisma);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose membership belongs to a different user', async () => {
    const config = createConfig();
    const { prisma, findUnique } = createPrisma();
    findUnique.mockResolvedValue({
      id: 'membership-1',
      userId: 'someone-else',
      companyId: 'company-1',
      status: 'active',
    });
    const strategy = new JwtStrategy(config, prisma);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose membership is not active', async () => {
    const config = createConfig();
    const { prisma, findUnique } = createPrisma();
    findUnique.mockResolvedValue({
      id: 'membership-1',
      userId: 'user-1',
      companyId: 'company-1',
      status: 'revoked',
    });
    const strategy = new JwtStrategy(config, prisma);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose company context does not match the membership', async () => {
    const config = createConfig();
    const { prisma, findUnique } = createPrisma();
    findUnique.mockResolvedValue({
      id: 'membership-1',
      userId: 'user-1',
      companyId: 'company-999',
      status: 'active',
    });
    const strategy = new JwtStrategy(config, prisma);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
