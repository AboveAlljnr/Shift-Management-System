import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { REQUIRED_PERMISSION_KEY } from '../../common/decorators/required-permission.decorator';

import { AuthorizationService } from './authorization.service';

/**
 * Global guard enforcing @RequiredPermission(...) metadata. Resolves the
 * member's effective permissions from the authenticated request principal
 * (membershipId from the JWT, ADR-004) and denies (403) when any required
 * action is missing. Deny-by-default: un-decorated endpoints are unaffected.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredActions = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredActions || requiredActions.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: { membershipId?: string } }>();
    const membershipId = request.user?.membershipId;

    if (!membershipId) {
      throw new ForbiddenException('User is not authenticated');
    }

    const effective = await this.authorizationService.getEffectivePermissions(membershipId);
    const missing = requiredActions.filter((action) => !effective.includes(action));

    if (missing.length > 0) {
      throw new ForbiddenException('Insufficient permission');
    }

    return true;
  }
}