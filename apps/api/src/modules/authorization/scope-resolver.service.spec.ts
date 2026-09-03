import { describe, it, expect } from 'vitest';

import { ScopeResolver } from './scope-resolver.service';
import type { GrantedScope } from './scope-resolver.service';

const resolver = new ScopeResolver();

/**
 * ADR-003 scope inheritance: Company -> Branch -> Department -> Team -> Employee.
 * A granted scope covers itself and its organizational descendants only; it never
 * reaches upward (parent) or laterally (siblings).
 */

describe('ScopeResolver.canAccessTarget — company scope', () => {
  const scopes: GrantedScope[] = [{ scopeType: 'company', scopeId: 'company-a' }];

  it('covers the company itself', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a' })).toBe(true);
  });

  it('covers every descendant node (branch, department, team, employee)', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1', departmentId: 'd1', teamId: 't1', employeeId: 'e1' })).toBe(true);
  });

  it('covers another tenant only when the company id matches', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-b' })).toBe(false);
  });
});

describe('ScopeResolver.canAccessTarget — branch scope', () => {
  const scopes: GrantedScope[] = [{ scopeType: 'branch', scopeId: 'b1' }];

  it('covers the branch itself', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1' })).toBe(true);
  });

  it('inherits downward to departments, teams, and employees of that branch', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1', departmentId: 'd1', teamId: 't1', employeeId: 'e1' })).toBe(true);
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1' })).toBe(true);
  });

  it('does not cover a sibling branch of the same company', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b2' })).toBe(false);
  });

  it('fails closed when the target does not expose the branch it belongs to', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a' })).toBe(false);
  });

  it('never widens a branch grant into company-level access', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a' })).toBe(false);
  });
});

describe('ScopeResolver.canAccessTarget — department scope', () => {
  const scopes: GrantedScope[] = [{ scopeType: 'department', scopeId: 'd1' }];

  it('covers the department itself', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1', departmentId: 'd1' })).toBe(true);
  });

  it('inherits downward to teams and employees of that department', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1', departmentId: 'd1', teamId: 't1', employeeId: 'e1' })).toBe(true);
  });

  it('does NOT reach upward to the parent branch', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1' })).toBe(false);
  });

  it('does not cover a sibling department', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1', departmentId: 'd2' })).toBe(false);
  });

  it('fails closed when the target does not expose its department', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1', teamId: 't1' })).toBe(false);
  });
});

describe('ScopeResolver.canAccessTarget — team scope', () => {
  const scopes: GrantedScope[] = [{ scopeType: 'team', scopeId: 't1' }];

  it('covers the team itself', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1', departmentId: 'd1', teamId: 't1' })).toBe(true);
  });

  it('inherits downward to the employees of that team', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1', departmentId: 'd1', teamId: 't1', employeeId: 'e1' })).toBe(true);
  });

  it('does NOT reach upward to its department or branch', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1', departmentId: 'd1' })).toBe(false);
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1' })).toBe(false);
  });

  it('does not cover a sibling team', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1', departmentId: 'd1', teamId: 't2' })).toBe(false);
  });
});

describe('ScopeResolver.canAccessTarget — self scope', () => {
  const scopes: GrantedScope[] = [{ scopeType: 'self', scopeId: 'e1' }];

  it('covers only the employee identified by the scope', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1', departmentId: 'd1', teamId: 't1', employeeId: 'e1' })).toBe(true);
  });

  it('does not cover a colleague in the same team/branch/company', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1', departmentId: 'd1', teamId: 't1', employeeId: 'e2' })).toBe(false);
  });

  it('fails closed when the target does not expose its employee owner', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1' })).toBe(false);
  });
});

describe('ScopeResolver.canAccessTarget — union of scopes', () => {
  const scopes: GrantedScope[] = [
    { scopeType: 'branch', scopeId: 'b1' },
    { scopeType: 'team', scopeId: 't5' },
  ];

  it('grants access if any granted scope covers the target', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b1' })).toBe(true);
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b9', departmentId: 'd9', teamId: 't5' })).toBe(true);
  });

  it('denies when no granted scope covers the target', () => {
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b2' })).toBe(false);
    expect(resolver.canAccessTarget(scopes, { companyId: 'company-a', branchId: 'b9', departmentId: 'd9', teamId: 't7', employeeId: 'e7' })).toBe(false);
  });
});

describe('ScopeResolver.expand', () => {
  it('groups every granted scope into its own node bucket', () => {
    const scopes: GrantedScope[] = [
      { scopeType: 'company', scopeId: 'c1' },
      { scopeType: 'branch', scopeId: 'b1' },
      { scopeType: 'department', scopeId: 'd1' },
      { scopeType: 'team', scopeId: 't1' },
      { scopeType: 'self', scopeId: 'e1' },
    ];

    expect(resolver.expand(scopes)).toEqual({
      companyIds: ['c1'],
      branchIds: ['b1'],
      departmentIds: ['d1'],
      teamIds: ['t1'],
      employeeIds: ['e1'],
    });
  });

  it('ignores empty scope lists', () => {
    expect(resolver.expand([])).toEqual({
      companyIds: [],
      branchIds: [],
      departmentIds: [],
      teamIds: [],
      employeeIds: [],
    });
  });
});