import { describe, it, expect, vi } from 'vitest';

import {
  ScopeFilterService,
  bucketScopes,
  employeeScopePredicate,
  shiftScopePredicate,
  branchScopePredicate,
  departmentScopePredicate,
  teamScopePredicate,
  positionScopePredicate,
  isPlacementInScope,
} from './scope-filter.service';
import type { GrantedScope } from './scope-resolver.service';

function serviceGranting(scopes: GrantedScope[]): ScopeFilterService {
  const authorization = {
    getScopes: vi.fn().mockResolvedValue(scopes),
  };
  return new ScopeFilterService(authorization as never);
}

describe('bucketScopes', () => {
  it('treats a company-wide grant for the active tenant as unrestricted', () => {
    const scopes: GrantedScope[] = [{ scopeType: 'company', scopeId: 'company-a' }];
    expect(bucketScopes(scopes, 'company-a')).toEqual({
      unrestricted: true,
      buckets: { branchIds: [], departmentIds: [], teamIds: [], employeeIds: [] },
    });
  });

  it('does not treat a company grant of ANOTHER tenant as unrestricted', () => {
    const scopes: GrantedScope[] = [{ scopeType: 'company', scopeId: 'company-b' }];
    expect(bucketScopes(scopes, 'company-a').unrestricted).toBe(false);
  });

  it('buckets each scope type and dedupes ids', () => {
    const scopes: GrantedScope[] = [
      { scopeType: 'branch', scopeId: 'b1' },
      { scopeType: 'branch', scopeId: 'b1' },
      { scopeType: 'department', scopeId: 'd1' },
      { scopeType: 'team', scopeId: 't1' },
      { scopeType: 'self', scopeId: 'e1' },
    ];
    expect(bucketScopes(scopes, 'company-a')).toEqual({
      unrestricted: false,
      buckets: { branchIds: ['b1'], departmentIds: ['d1'], teamIds: ['t1'], employeeIds: ['e1'] },
    });
  });

  it('produces empty buckets when no scopes are granted (deny by default)', () => {
    expect(bucketScopes([], 'company-a')).toEqual({
      unrestricted: false,
      buckets: { branchIds: [], departmentIds: [], teamIds: [], employeeIds: [] },
    });
  });
});

describe('employeeScopePredicate', () => {
  it('maps branch/department/team/self buckets to an OR of equality clauses', () => {
    expect(
      employeeScopePredicate({
        branchIds: ['b1'],
        departmentIds: ['d1'],
        teamIds: ['t1'],
        employeeIds: ['e1'],
      }),
    ).toEqual({
      OR: [
        { branchId: { in: ['b1'] } },
        { departmentId: { in: ['d1'] } },
        { teamId: { in: ['t1'] } },
        { id: { in: ['e1'] } },
      ],
    });
  });

  it('returns a match-nothing predicate when no buckets are granted', () => {
    expect(
      employeeScopePredicate({ branchIds: [], departmentIds: [], teamIds: [], employeeIds: [] }),
    ).toEqual({ OR: [{ id: { in: [] } }] });
  });
});

describe('shiftScopePredicate', () => {
  it('scopes shift rows via org buckets', () => {
    expect(
      shiftScopePredicate({
        branchIds: ['b1'],
        departmentIds: [],
        teamIds: [],
        employeeIds: [],
      }),
    ).toEqual({ OR: [{ branchId: { in: ['b1'] } }] });
  });

  it('scopes self grants through assignments rather than a non-existent shift employee id', () => {
    expect(
      shiftScopePredicate({
        branchIds: [],
        departmentIds: [],
        teamIds: [],
        employeeIds: ['e1'],
      }),
    ).toEqual({ OR: [{ assignments: { some: { employeeId: { in: ['e1'] } } } }] });
  });
});

describe('org node predicates', () => {
  it('branch predicate only matches granted branches (department-scoped sees nothing)', () => {
    expect(
      branchScopePredicate({ branchIds: [], departmentIds: ['d1'], teamIds: [], employeeIds: [] }),
    ).toEqual({ OR: [{ id: { in: [] } }] });
    expect(
      branchScopePredicate({ branchIds: ['b1'], departmentIds: [], teamIds: [], employeeIds: [] }),
    ).toEqual({ OR: [{ id: { in: ['b1'] } }] });
  });

  it('department predicate matches own department or any branch in scope', () => {
    expect(
      departmentScopePredicate({ branchIds: ['b1'], departmentIds: ['d1'], teamIds: [], employeeIds: [] }),
    ).toEqual({ OR: [{ branchId: { in: ['b1'] } }, { id: { in: ['d1'] } }] });
  });

  it('team predicate climbs through department branch ancestry', () => {
    expect(
      teamScopePredicate({ branchIds: ['b1'], departmentIds: ['d1'], teamIds: ['t1'], employeeIds: [] }),
    ).toEqual({
      OR: [
        { department: { branchId: { in: ['b1'] } } },
        { departmentId: { in: ['d1'] } },
        { id: { in: ['t1'] } },
      ],
    });
  });

  it('position predicate climbs through department ancestry', () => {
    expect(
      positionScopePredicate({ branchIds: ['b1'], departmentIds: ['d1'], teamIds: [], employeeIds: [] }),
    ).toEqual({
      OR: [
        { department: { branchId: { in: ['b1'] } } },
        { departmentId: { in: ['d1'] } },
      ],
    });
  });
});

describe('isPlacementInScope', () => {
  const buckets = { branchIds: ['b1'], departmentIds: ['d1'], teamIds: ['t1'], employeeIds: ['e1'] };

  it('matches any org dimension of the placement (mirrors the read predicate)', () => {
    expect(isPlacementInScope(buckets, { branchId: 'b1' })).toBe(true);
    expect(isPlacementInScope(buckets, { departmentId: 'd1' })).toBe(true);
    expect(isPlacementInScope(buckets, { teamId: 't1' })).toBe(true);
    expect(isPlacementInScope(buckets, { employeeId: 'e1' })).toBe(true);
  });

  it('does not match out-of-scope or null/absent placements', () => {
    expect(isPlacementInScope(buckets, { branchId: 'b2' })).toBe(false);
    expect(isPlacementInScope(buckets, { departmentId: 'd9' })).toBe(false);
    expect(isPlacementInScope(buckets, { branchId: 'b1', teamId: 't9' })).toBe(true);
    expect(isPlacementInScope(buckets, {})).toBe(false);
    expect(isPlacementInScope(buckets, { branchId: null })).toBe(false);
  });

  it('a grant-less bucket set covers nothing (deny by default)', () => {
    expect(
      isPlacementInScope({ branchIds: [], departmentIds: [], teamIds: [], employeeIds: [] }, {
        branchId: 'b1',
      }),
    ).toBe(false);
  });
});

describe('ScopeFilterService.resolveScope', () => {
  it('returns unrestricted=true for a company-wide grant of the active tenant', async () => {
    const service = serviceGranting([{ scopeType: 'company', scopeId: 'company-a' }]);
    expect(await service.resolveScope('m1', 'company-a')).toEqual({
      unrestricted: true,
      buckets: { branchIds: [], departmentIds: [], teamIds: [], employeeIds: [] },
    });
  });

  it('returns the bucketed scopes for a scoped member (used by write-path checks)', async () => {
    const service = serviceGranting([
      { scopeType: 'branch', scopeId: 'b1' },
      { scopeType: 'department', scopeId: 'd1' },
    ]);
    expect(await service.resolveScope('m1', 'company-a')).toEqual({
      unrestricted: false,
      buckets: { branchIds: ['b1'], departmentIds: ['d1'], teamIds: [], employeeIds: [] },
    });
  });
});

describe('ScopeFilterService', () => {
  it('returns no predicate for a company-wide grant', async () => {
    const service = serviceGranting([{ scopeType: 'company', scopeId: 'company-a' }]);
    expect(await service.employeeWhere('m1', 'company-a')).toBeUndefined();
    expect(await service.shiftQueryScope('m1', 'company-a')).toEqual({
      shiftWhere: undefined,
      assignmentEmployeeWhere: undefined,
    });
    expect(await service.branchWhere('m1', 'company-a')).toBeUndefined();
  });

  it('delegates to getScopes with the caller membership and builds predicates', async () => {
    const authorization = { getScopes: vi.fn().mockResolvedValue([{ scopeType: 'branch', scopeId: 'b1' }]) };
    const service = new ScopeFilterService(authorization as never);

    await service.employeeWhere('member-1', 'company-a');
    await service.employeeRelationWhere('member-1', 'company-a');
    await service.shiftWhere('member-1', 'company-a');
    await service.branchWhere('member-1', 'company-a');
    await service.departmentWhere('member-1', 'company-a');
    await service.teamWhere('member-1', 'company-a');
    await service.positionWhere('member-1', 'company-a');

    expect(authorization.getScopes).toHaveBeenCalledWith('member-1');
  });

  it('wraps the employee predicate in a relation filter for attendance/leave rows', async () => {
    const service = serviceGranting([{ scopeType: 'department', scopeId: 'd1' }]);
    expect(await service.employeeRelationWhere('m1', 'company-a')).toEqual({
      employee: { OR: [{ departmentId: { in: ['d1'] } }] },
    });
  });
});