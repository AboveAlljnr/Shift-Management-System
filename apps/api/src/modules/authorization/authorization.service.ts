import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/database/prisma.service';

import { ScopeResolver } from './scope-resolver.service';
import type { GrantedScope, ScopeTarget } from './scope-resolver.service';

/**
 * Central authorization point (ADR-003). Every access decision is:
 *
 *   Permission (from roles + overrides)
 *       AND
 *   Authorized scope (downward-only organizational hierarchy)
 *
 * Deny by default: if the membership cannot be resolved, if the permission is
 * absent, or if the target falls outside the granted scopes, access is denied.
 */
@Injectable()
export class AuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeResolver: ScopeResolver,
  ) {}

  /**
   * Effective permission actions for a membership = union of its roles'
   * permissions, then site overrides (grant adds, revoke removes).
   */
  async getEffectivePermissions(membershipId: string): Promise<string[]> {
    const membership = await this.prisma.companyMembership.findUnique({
      where: { id: membershipId },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
        permissionOverrides: {
          include: { permission: true },
        },
      },
    });

    if (!membership) return [];

    const actions = new Set<string>();
    for (const userRole of membership.roles) {
      for (const rolePermission of userRole.role.permissions) {
        actions.add(rolePermission.permission.action);
      }
    }

    for (const override of membership.permissionOverrides) {
      if (override.type === 'grant') {
        actions.add(override.permission.action);
      } else {
        actions.delete(override.permission.action);
      }
    }

    return Array.from(actions);
  }

  async hasPermission(membershipId: string, action: string): Promise<boolean> {
    const effective = await this.getEffectivePermissions(membershipId);
    return effective.includes(action);
  }

  async getScopes(membershipId: string): Promise<GrantedScope[]> {
    const scopes = await this.prisma.accessScope.findMany({
      where: { membershipId },
    });

    return scopes.map((s) => ({ scopeType: s.scopeType, scopeId: s.scopeId }));
  }

  /**
   * Binary access decision for an action against an organisational target.
   * Requires BOTH the permission AND a granted scope covering the target.
   */
  async canAccess(membershipId: string, action: string, target: ScopeTarget): Promise<boolean> {
    const [effective, scopes] = await Promise.all([
      this.getEffectivePermissions(membershipId),
      this.getScopes(membershipId),
    ]);

    if (!effective.includes(action)) return false;
    return this.scopeResolver.canAccessTarget(scopes, target);
  }
}