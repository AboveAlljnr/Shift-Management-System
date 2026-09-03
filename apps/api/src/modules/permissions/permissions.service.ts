import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRoles(companyId: string) {
    return this.prisma.role.findMany({
      where: {
        OR: [{ companyId }, { isSystemRole: true, companyId: null }],
        isActive: true,
      },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });
  }

  async createRole(
    companyId: string,
    data: { name: string; code: string; description?: string; permissionIds: string[] },
  ) {
    const existing = await this.prisma.role.findFirst({
      where: { companyId, code: data.code },
    });

    if (existing) {
      throw new ConflictException(`Role with code '${data.code}' already exists`);
    }

    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          companyId,
          name: data.name,
          code: data.code,
          description: data.description,
          isSystemRole: false,
        },
      });

      if (data.permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: data.permissionIds.map((permissionId) => ({
            roleId: role.id,
            permissionId,
          })),
        });
      }

      return role;
    });
  }

  async getPermissions() {
    return this.prisma.permission.findMany({
      orderBy: { action: 'asc' },
    });
  }

  async getEffectivePermissions(membershipId: string) {
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

    if (!membership) {
      throw new NotFoundException(`Membership ${membershipId} not found`);
    }

    // 1. Gather all actions from assigned roles
    const actions = new Set<string>();
    for (const ur of membership.roles) {
      for (const rp of ur.role.permissions) {
        actions.add(rp.permission.action);
      }
    }

    // 2. Apply individual overrides (grant / revoke)
    for (const override of membership.permissionOverrides) {
      if (override.type === 'grant') {
        actions.add(override.permission.action);
      } else if (override.type === 'revoke') {
        actions.delete(override.permission.action);
      }
    }

    return Array.from(actions);
  }

  async resolveScopes(membershipId: string) {
    const scopes = await this.prisma.accessScope.findMany({
      where: { membershipId },
    });

    return scopes.map((s) => ({
      scopeType: s.scopeType,
      scopeId: s.scopeId,
    }));
  }
}
