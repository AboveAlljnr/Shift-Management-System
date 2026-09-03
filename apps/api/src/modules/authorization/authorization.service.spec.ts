import { ROLE_PERMISSION_TEMPLATES } from '@sms/shared';
import { describe, it, expect, vi } from 'vitest';

import { AuthorizationService } from './authorization.service';
import { ScopeResolver } from './scope-resolver.service';

function membershipWith(roleCodes: string[]): {
  id: string;
  roles: { role: { permissions: { permission: { action: string } }[] } }[];
  permissionOverrides: { type: string; permission: { action: string } }[];
} {
  const permissionSets = roleCodes
    .map((code) => ROLE_PERMISSION_TEMPLATES[code])
    .filter((template): template is readonly string[] => Boolean(template));

  return {
    id: 'm1',
    roles: permissionSets.map((permissions) => ({
      role: {
        permissions: permissions.map((action) => ({
          permission: { action },
        })),
      },
    })),
    permissionOverrides: [],
  };
}

describe('AuthorizationService — effective permissions', () => {
  it('unions permissions from all roles of the membership', async () => {
    const prisma = { companyMembership: { findUnique: vi.fn().mockResolvedValue(membershipWith(['MANAGER', 'SHIFT_MANAGER'])) } };
    const service = new AuthorizationService(
      prisma as never,
      new ScopeResolver(),
    );

    const effective = await service.getEffectivePermissions('m1');

    expect(effective).toContain('schedule.publish');
    expect(effective).toContain('employee.create');
    // role boundary: a plain manager must NOT inherit admin-only capabilities
    expect(effective).not.toContain('billing.manage');
    expect(effective).not.toContain('company.settings.manage');
    expect(effective).not.toContain('role.manage');
  });

  it('applies grant overrides on top of role permissions', async () => {
    const membership = {
      id: 'm1',
      roles: [],
      permissionOverrides: [
        { type: 'grant', permission: { action: 'document.upload' } },
      ],
    };
    const prisma = { companyMembership: { findUnique: vi.fn().mockResolvedValue(membership) } };
    const service = new AuthorizationService(prisma as never, new ScopeResolver());

    expect(await service.hasPermission('m1', 'document.upload')).toBe(true);
  });

  it('applies revoke overrides that remove permissions granted by a role', async () => {
    const membership = {
      id: 'm1',
      roles: membershipWith(['MANAGER']).roles,
      permissionOverrides: [
        { type: 'revoke', permission: { action: 'schedule.publish' } },
      ],
    };
    const prisma = { companyMembership: { findUnique: vi.fn().mockResolvedValue(membership) } };
    const service = new AuthorizationService(prisma as never, new ScopeResolver());

    expect(await service.hasPermission('m1', 'schedule.edit')).toBe(true);
    expect(await service.hasPermission('m1', 'schedule.publish')).toBe(false);
  });

  it('denies by default when the membership does not exist', async () => {
    const prisma = { companyMembership: { findUnique: vi.fn().mockResolvedValue(null) } };
    const service = new AuthorizationService(prisma as never, new ScopeResolver());

    expect(await service.getEffectivePermissions('ghost')).toEqual([]);
    expect(await service.hasPermission('ghost', 'schedule.read')).toBe(false);
  });
});

describe('AuthorizationService — role/type boundaries (docs/03-auth/roles.md)', () => {
  it('Owner holds the full canonical permission set', async () => {
    const prisma = { companyMembership: { findUnique: vi.fn().mockResolvedValue(membershipWith(['OWNER'])) } };
    const service = new AuthorizationService(prisma as never, new ScopeResolver());

    const effective = await service.getEffectivePermissions('m1');

    expect(effective).toContain('billing.manage');
    expect(effective).toContain('permission.override');
    expect(effective).toContain('employee.read_sensitive');
    expect(effective.length).toBe((ROLE_PERMISSION_TEMPLATES['OWNER'] ?? []).length);
  });

  it('Admin manages company members and roles but cannot mutate billing', async () => {
    const prisma = { companyMembership: { findUnique: vi.fn().mockResolvedValue(membershipWith(['ADMIN'])) } };
    const service = new AuthorizationService(prisma as never, new ScopeResolver());

    const effective = await service.getEffectivePermissions('m1');

    expect(effective).toContain('company.members.manage');
    expect(effective).toContain('role.manage');
    expect(effective).toContain('leave_balance.adjust');
    // boundary: no private-account access, no entitlement changes
    expect(effective).not.toContain('billing.manage');
    expect(effective).not.toContain('document.read_sensitive');
  });

  it('Manager schedules and corrects attendance but cannot change roles or billing', async () => {
    const prisma = { companyMembership: { findUnique: vi.fn().mockResolvedValue(membershipWith(['MANAGER'])) } };
    const service = new AuthorizationService(prisma as never, new ScopeResolver());

    const effective = await service.getEffectivePermissions('m1');

    expect(effective).toContain('shift.assign');
    expect(effective).toContain('attendance.correct');
    expect(effective).toContain('leave.approve');
    expect(effective).toContain('report.view');
    // boundary: managers do not mint roles or touch money
    expect(effective).not.toContain('role.manage');
    expect(effective).not.toContain('billing.view');
  });

  it('Shift Manager only reads and assigns within scope; delegates leave/reporting to managers', async () => {
    const prisma = { companyMembership: { findUnique: vi.fn().mockResolvedValue(membershipWith(['SHIFT_MANAGER'])) } };
    const service = new AuthorizationService(prisma as never, new ScopeResolver());

    const effective = await service.getEffectivePermissions('m1');

    expect(effective).toContain('schedule.read');
    expect(effective).toContain('shift.assign');
    expect(effective).toContain('attendance.read');
    // boundary: cannot create employees, publish, approve leave, or read reports
    expect(effective).not.toContain('employee.create');
    expect(effective).not.toContain('schedule.publish');
    expect(effective).not.toContain('leave.approve');
    expect(effective).not.toContain('report.view');
  });

  it('Employee is limited to self-service', async () => {
    const prisma = { companyMembership: { findUnique: vi.fn().mockResolvedValue(membershipWith(['EMPLOYEE'])) } };
    const service = new AuthorizationService(prisma as never, new ScopeResolver());

    const effective = await service.getEffectivePermissions('m1');

    expect(effective).toContain('leave.request');
    expect(effective).toContain('schedule.read');
    // boundary: cannot create employees, correct attendance, or approve leave
    expect(effective).not.toContain('employee.create');
    expect(effective).not.toContain('attendance.correct');
    expect(effective).not.toContain('leave.approve');
  });
});

describe('AuthorizationService.canAccess — permission AND scope together', () => {
  function serviceWith(membership: unknown, scopes: { scopeType: string; scopeId: string }[]) {
    const prisma = {
      companyMembership: { findUnique: vi.fn().mockResolvedValue(membership) },
      accessScope: { findMany: vi.fn().mockResolvedValue(scopes) },
    };
    return new AuthorizationService(prisma as never, new ScopeResolver());
  }

  it('allows an owner (company scope) everywhere in the company', async () => {
    const service = serviceWith(membershipWith(['OWNER']), [{ scopeType: 'company', scopeId: 'company-a' }]);

    expect(await service.canAccess('m1', 'employee.update', { companyId: 'company-a', branchId: 'b1', departmentId: 'd1', teamId: 't1', employeeId: 'e1' })).toBe(true);
  });

  it('allows a manager with permission whose granted branch covers the employee', async () => {
    const service = serviceWith(membershipWith(['MANAGER']), [
      { scopeType: 'branch', scopeId: 'b1' },
    ]);

    expect(await service.canAccess('m1', 'attendance.correct', { companyId: 'company-a', branchId: 'b1', departmentId: 'd1', teamId: 't1', employeeId: 'e1' })).toBe(true);
  });

  it('denies a manager acting outside the granted branch scope', async () => {
    const service = serviceWith(membershipWith(['MANAGER']), [
      { scopeType: 'branch', scopeId: 'b1' },
    ]);

    expect(await service.canAccess('m1', 'attendance.correct', { companyId: 'company-a', branchId: 'b2', departmentId: 'd3', teamId: 't3', employeeId: 'e9' })).toBe(false);
  });

  it('denies an employee without the permission even inside the allowed scope', async () => {
    const service = serviceWith(membershipWith(['EMPLOYEE']), [
      { scopeType: 'self', scopeId: 'e1' },
    ]);

    expect(await service.canAccess('m1', 'attendance.correct', { companyId: 'company-a', branchId: 'b1', departmentId: 'd1', teamId: 't1', employeeId: 'e1' })).toBe(false);
  });

  it('denies a manager with permission but no matching scope at all', async () => {
    const service = serviceWith(membershipWith(['MANAGER']), []);

    expect(await service.canAccess('m1', 'employee.read', { companyId: 'company-a', branchId: 'b1' })).toBe(false);
  });

  it('denies across tenants even for an owner-level permission set', async () => {
    const service = serviceWith(membershipWith(['OWNER']), [{ scopeType: 'company', scopeId: 'company-a' }]);

    expect(await service.canAccess('m1', 'employee.read', { companyId: 'company-b', branchId: 'b1' })).toBe(false);
  });
});