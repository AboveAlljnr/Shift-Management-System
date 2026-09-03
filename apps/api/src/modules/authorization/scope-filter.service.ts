import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuthorizationService } from './authorization.service';
import type { GrantedScope } from './scope-resolver.service';

/**
 * ADR-003 row-level scope filter.
 *
 * A member's granted AccessScopes (company → branch → department → team →
 * self, downward-only) are turned into Prisma `where` predicates so every
 * SERVICE-LEVEL list/read query is constrained to records inside the member's
 * effective scope. Client-supplied org ids (branchId/departmentId/teamId/
 * employeeId query params) never widen this: they compose AND-wise with the
 * scope predicate.
 *
 * Invariants:
 *  - company-scope for the active tenant  → no extra predicate (tenant `where`
 *    still applies upstream).
 *  - anything else                        → predicate over granted branch /
 *    department / team / self buckets; a grant-less member gets a
 *    match-nothing predicate (deny by default).
 */

export interface ScopeBuckets {
  branchIds: string[];
  departmentIds: string[];
  teamIds: string[];
  employeeIds: string[];
}

/**
 * The organisational placement of an employee record — used for WRITE target
 * checks. Mirrors the fields the Employee row predicates key on.
 */
export interface OrgPlacement {
  branchId?: string | null;
  departmentId?: string | null;
  teamId?: string | null;
  employeeId?: string | null;
}

/**
 * True when the placement falls inside the granted buckets, mirroring
 * `employeeScopePredicate` exactly (branch OR department OR team OR self id).
 * A grant-less bucket set covers nothing (deny by default).
 */
export function isPlacementInScope(buckets: ScopeBuckets, placement: OrgPlacement): boolean {
  if (placement.branchId && buckets.branchIds.includes(placement.branchId)) return true;
  if (placement.departmentId && buckets.departmentIds.includes(placement.departmentId)) {
    return true;
  }
  if (placement.teamId && buckets.teamIds.includes(placement.teamId)) return true;
  if (placement.employeeId && buckets.employeeIds.includes(placement.employeeId)) return true;
  return false;
}

export function emptyBuckets(): ScopeBuckets {
  return { branchIds: [], departmentIds: [], teamIds: [], employeeIds: [] };
}

/**
 * Reduces granted scopes to per-tenant buckets. When a company-wide scope for
 * the active tenant is present the member is unrestricted within the tenant
 * (`unrestricted: true`) and the buckets are irrelevant.
 */
export function bucketScopes(
  scopes: GrantedScope[],
  companyId: string,
): { unrestricted: boolean; buckets: ScopeBuckets } {
  if (
    scopes.some((scope) => scope.scopeType === 'company' && scope.scopeId === companyId)
  ) {
    return { unrestricted: true, buckets: emptyBuckets() };
  }

  const buckets = emptyBuckets();
  for (const scope of scopes) {
    switch (scope.scopeType) {
      case 'branch':
        if (!buckets.branchIds.includes(scope.scopeId)) buckets.branchIds.push(scope.scopeId);
        break;
      case 'department':
        if (!buckets.departmentIds.includes(scope.scopeId)) buckets.departmentIds.push(scope.scopeId);
        break;
      case 'team':
        if (!buckets.teamIds.includes(scope.scopeId)) buckets.teamIds.push(scope.scopeId);
        break;
      case 'self':
        if (!buckets.employeeIds.includes(scope.scopeId)) buckets.employeeIds.push(scope.scopeId);
        break;
      default:
        break;
    }
  }
  return { unrestricted: false, buckets };
}

function matchNothing<T>(clauses: T[]): { OR: T[] } {
  return clauses.length > 0
    ? { OR: clauses }
    : { OR: [{ id: { in: [] } } as unknown as T] };
}

/** Predicate over Employee rows: org-node buckets plus self by employee id. */
export function employeeScopePredicate(buckets: ScopeBuckets): Prisma.EmployeeWhereInput {
  const clauses: Prisma.EmployeeWhereInput[] = [];
  if (buckets.branchIds.length > 0) clauses.push({ branchId: { in: buckets.branchIds } });
  if (buckets.departmentIds.length > 0) {
    clauses.push({ departmentId: { in: buckets.departmentIds } });
  }
  if (buckets.teamIds.length > 0) clauses.push({ teamId: { in: buckets.teamIds } });
  if (buckets.employeeIds.length > 0) clauses.push({ id: { in: buckets.employeeIds } });
  return matchNothing(clauses);
}

/** Predicate over Shift rows: org-node buckets plus self via assignments. */
export function shiftScopePredicate(buckets: ScopeBuckets): Prisma.ShiftWhereInput {
  const clauses: Prisma.ShiftWhereInput[] = [];
  if (buckets.branchIds.length > 0) clauses.push({ branchId: { in: buckets.branchIds } });
  if (buckets.departmentIds.length > 0) {
    clauses.push({ departmentId: { in: buckets.departmentIds } });
  }
  if (buckets.teamIds.length > 0) clauses.push({ teamId: { in: buckets.teamIds } });
  if (buckets.employeeIds.length > 0) {
    clauses.push({ assignments: { some: { employeeId: { in: buckets.employeeIds } } } });
  }
  return matchNothing(clauses);
}

/** Predicate over Branch rows: a branch is reachable only via a branch grant. */
export function branchScopePredicate(buckets: ScopeBuckets): Prisma.BranchWhereInput {
  const clauses: Prisma.BranchWhereInput[] = [];
  if (buckets.branchIds.length > 0) clauses.push({ id: { in: buckets.branchIds } });
  return matchNothing(clauses);
}

/** Predicate over Department rows: own department grants or branch grants. */
export function departmentScopePredicate(buckets: ScopeBuckets): Prisma.DepartmentWhereInput {
  const clauses: Prisma.DepartmentWhereInput[] = [];
  if (buckets.branchIds.length > 0) clauses.push({ branchId: { in: buckets.branchIds } });
  if (buckets.departmentIds.length > 0) clauses.push({ id: { in: buckets.departmentIds } });
  return matchNothing(clauses);
}

/** Predicate over Team rows: own team, own department, or branch grants. */
export function teamScopePredicate(buckets: ScopeBuckets): Prisma.TeamWhereInput {
  const clauses: Prisma.TeamWhereInput[] = [];
  if (buckets.branchIds.length > 0) {
    clauses.push({ department: { branchId: { in: buckets.branchIds } } });
  }
  if (buckets.departmentIds.length > 0) {
    clauses.push({ departmentId: { in: buckets.departmentIds } });
  }
  if (buckets.teamIds.length > 0) clauses.push({ id: { in: buckets.teamIds } });
  return matchNothing(clauses);
}

/** Predicate over Position rows: positions attached to a granted department/branch. */
export function positionScopePredicate(buckets: ScopeBuckets): Prisma.PositionWhereInput {
  const clauses: Prisma.PositionWhereInput[] = [];
  if (buckets.branchIds.length > 0) {
    clauses.push({ department: { branchId: { in: buckets.branchIds } } });
  }
  if (buckets.departmentIds.length > 0) {
    clauses.push({ departmentId: { in: buckets.departmentIds } });
  }
  return matchNothing(clauses);
}

@Injectable()
export class ScopeFilterService {
  constructor(private readonly authorizationService: AuthorizationService) {}

  private async resolve(
    membershipId: string,
    companyId: string,
  ): Promise<{ unrestricted: boolean; buckets: ScopeBuckets }> {
    const scopes = await this.authorizationService.getScopes(membershipId);
    return bucketScopes(scopes, companyId);
  }

  /**
   * Exposes the resolved effective scope (unrestricted flag + id buckets) so
   * write paths can authorize the TARGET (placement) of a mutation in the same
   * terms the read paths filter rows.
   */
  resolveScope(
    membershipId: string,
    companyId: string,
  ): Promise<{ unrestricted: boolean; buckets: ScopeBuckets }> {
    return this.resolve(membershipId, companyId);
  }

  /**
   * Shift-row predicate plus the predicate to apply to a shift's nested
   * `assignments` include (employees visible in an in-scope shift). Resolves
   * the member's scopes once for both.
   */
  async shiftQueryScope(
    membershipId: string,
    companyId: string,
  ): Promise<{
    shiftWhere?: Prisma.ShiftWhereInput;
    assignmentEmployeeWhere?: Prisma.EmployeeWhereInput;
  }> {
    const { unrestricted, buckets } = await this.resolve(membershipId, companyId);
    if (unrestricted) {
      return { shiftWhere: undefined, assignmentEmployeeWhere: undefined };
    }
    return {
      shiftWhere: shiftScopePredicate(buckets),
      assignmentEmployeeWhere: employeeScopePredicate(buckets),
    };
  }

  /**
   * Predicate constraining Employee rows to the member's scope, or undefined
   * when the member holds a company-wide scope (unrestricted within the tenant).
   */
  async employeeWhere(
    membershipId: string,
    companyId: string,
  ): Promise<Prisma.EmployeeWhereInput | undefined> {
    const { unrestricted, buckets } = await this.resolve(membershipId, companyId);
    return unrestricted ? undefined : employeeScopePredicate(buckets);
  }

  /**
   * Predicate constraining entities via their `employee` relation
   * (AttendanceRecord, LeaveRequest, LeaveBalance), or undefined when
   * company-wide.
   */
  async employeeRelationWhere(
    membershipId: string,
    companyId: string,
  ): Promise<{ employee: Prisma.EmployeeWhereInput } | undefined> {
    const inner = await this.employeeWhere(membershipId, companyId);
    return inner ? { employee: inner } : undefined;
  }

  /** Predicate constraining Shift rows (org buckets + self via assignments). */
  async shiftWhere(
    membershipId: string,
    companyId: string,
  ): Promise<Prisma.ShiftWhereInput | undefined> {
    const { unrestricted, buckets } = await this.resolve(membershipId, companyId);
    return unrestricted ? undefined : shiftScopePredicate(buckets);
  }

  /** Predicate constraining Branch rows. */
  async branchWhere(
    membershipId: string,
    companyId: string,
  ): Promise<Prisma.BranchWhereInput | undefined> {
    const { unrestricted, buckets } = await this.resolve(membershipId, companyId);
    return unrestricted ? undefined : branchScopePredicate(buckets);
  }

  /** Predicate constraining Department rows. */
  async departmentWhere(
    membershipId: string,
    companyId: string,
  ): Promise<Prisma.DepartmentWhereInput | undefined> {
    const { unrestricted, buckets } = await this.resolve(membershipId, companyId);
    return unrestricted ? undefined : departmentScopePredicate(buckets);
  }

  /** Predicate constraining Team rows. */
  async teamWhere(
    membershipId: string,
    companyId: string,
  ): Promise<Prisma.TeamWhereInput | undefined> {
    const { unrestricted, buckets } = await this.resolve(membershipId, companyId);
    return unrestricted ? undefined : teamScopePredicate(buckets);
  }

  /** Predicate constraining Position rows. */
  async positionWhere(
    membershipId: string,
    companyId: string,
  ): Promise<Prisma.PositionWhereInput | undefined> {
    const { unrestricted, buckets } = await this.resolve(membershipId, companyId);
    return unrestricted ? undefined : positionScopePredicate(buckets);
  }
}