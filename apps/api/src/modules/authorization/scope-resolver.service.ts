import { Injectable } from '@nestjs/common';
import type { ScopeType } from '@sms/shared';

/**
 * ADR-003 scopes: a scope grants access to itself and, downward only, to its
 * organizational descendants.
 *
 *   Company -> Branch -> Department -> Team -> Employee (self)
 *
 * Scope is never upward or lateral (a Team scope cannot reach its Department,
 * a Branch scope cannot reach another Branch).
 */

export interface GrantedScope {
  scopeType: ScopeType;
  scopeId: string;
}

/**
 * The organisational position of the resource being accessed. Only the fields
 * that are known about the target need to be provided; a check requiring an
 * unknown field fails closed (deny).
 */
export interface ScopeTarget {
  companyId: string;
  branchId?: string | null;
  departmentId?: string | null;
  teamId?: string | null;
  employeeId?: string | null;
}

export interface ResolvedScopeSet {
  companyIds: string[];
  branchIds: string[];
  departmentIds: string[];
  teamIds: string[];
  employeeIds: string[];
}

@Injectable()
export class ScopeResolver {
  /**
   * True when any granted scope covers the target through the downward-only
   * inheritance rule:
   * - 'company' covers the company (everything beneath it).
   * - 'branch' covers the branch (departments/teams/employees beneath it).
   * - 'department' covers the department (teams/employees beneath it).
   * - 'team' covers the team (employees within it).
   * - 'self' covers only the employee identified by scopeId.
   */
  canAccessTarget(scopes: GrantedScope[], target: ScopeTarget): boolean {
    return scopes.some((scope) => {
      switch (scope.scopeType) {
        case 'company':
          return scope.scopeId === target.companyId;
        case 'branch':
          return Boolean(target.branchId) && scope.scopeId === target.branchId;
        case 'department':
          return Boolean(target.departmentId) && scope.scopeId === target.departmentId;
        case 'team':
          return Boolean(target.teamId) && scope.scopeId === target.teamId;
        case 'self':
          return Boolean(target.employeeId) && scope.scopeId === target.employeeId;
        default:
          return false;
      }
    });
  }

  /** Expands granted scopes into the set of concrete organisational nodes they allow. */
  expand(scopes: GrantedScope[]): ResolvedScopeSet {
    const expanded: ResolvedScopeSet = {
      companyIds: [],
      branchIds: [],
      departmentIds: [],
      teamIds: [],
      employeeIds: [],
    };

    for (const scope of scopes) {
      switch (scope.scopeType) {
        case 'company':
          expanded.companyIds.push(scope.scopeId);
          break;
        case 'branch':
          expanded.branchIds.push(scope.scopeId);
          break;
        case 'department':
          expanded.departmentIds.push(scope.scopeId);
          break;
        case 'team':
          expanded.teamIds.push(scope.scopeId);
          break;
        case 'self':
          expanded.employeeIds.push(scope.scopeId);
          break;
        default:
          break;
      }
    }

    return expanded;
  }
}