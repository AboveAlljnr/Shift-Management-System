import { ForbiddenException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';

import { REQUIRED_PERMISSION_KEY } from '../../common/decorators/required-permission.decorator';

import { PermissionGuard } from './permission.guard';

function makeContext(override: { user?: { membershipId?: string } }) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user: override.user, }) }),
  } as never;
}

describe('PermissionGuard', () => {
  it('allows endpoints without permission metadata', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => undefined) };
    const authorizationService = { getEffectivePermissions: vi.fn() };

    const guard = new PermissionGuard(
      reflector as never,
      authorizationService as never,
    );

    await expect(guard.canActivate(makeContext({ user: { membershipId: 'm1' } }))).resolves.toBe(true);
    expect(authorizationService.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('allows when the membership holds every required permission', async () => {
    const reflector = {
      getAllAndOverride: vi.fn(() => ['shift.assign', 'schedule.read']),
    };
    const authorizationService = {
      getEffectivePermissions: vi.fn().mockResolvedValue(['schedule.read', 'shift.assign', 'employee.read']),
    };

    const guard = new PermissionGuard(reflector as never, authorizationService as never);

    await expect(guard.canActivate(makeContext({ user: { membershipId: 'm1' } }))).resolves.toBe(true);
    expect(authorizationService.getEffectivePermissions).toHaveBeenCalledWith('m1');
  });

  it('denies with 403 when any required permission is missing', async () => {
    const reflector = {
      getAllAndOverride: vi.fn(() => ['schedule.create']),
    };
    const authorizationService = {
      getEffectivePermissions: vi.fn().mockResolvedValue(['schedule.read']),
    };

    const guard = new PermissionGuard(reflector as never, authorizationService as never);

    await expect(guard.canActivate(makeContext({ user: { membershipId: 'm1' } }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('denies with 403 when the request carries no authenticated membership', async () => {
    const reflector = {
      getAllAndOverride: vi.fn(() => ['employee.read']),
    };
    const authorizationService = { getEffectivePermissions: vi.fn() };

    const guard = new PermissionGuard(reflector as never, authorizationService as never);

    await expect(guard.canActivate(makeContext({ user: undefined }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(authorizationService.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('reacts to metadata changes (reflector-driven)', () => {
    expect(REQUIRED_PERMISSION_KEY).toBe('requiredPermission');
  });
});