import { PERMISSION_ACTIONS } from '@sms/shared';
import { describe, it, expect } from 'vitest';

import { REQUIRED_PERMISSION_KEY } from '../../common/decorators/required-permission.decorator';
import { AttendanceController } from '../attendance/attendance.controller';
import { AuditController } from '../audit/audit.controller';
import { CompanyController } from '../company/company.controller';
import { EmployeeController } from '../employee/employee.controller';
import { LeaveController } from '../leave/leave.controller';
import { PermissionsController } from '../permissions/permissions.controller';
import { SchedulingController } from '../scheduling/scheduling.controller';

/**
 * Controller-level authorization matrix. Every documented permission-gated
 * endpoint must carry @RequiredPermission metadata, and every referenced action
 * must exist in the canonical catalog (no typos that silently open a route).
 */

type Controller = { prototype: Record<string, (...args: never[]) => unknown> };

function requireOne(ctrl: Controller, method: string, expected: string) {
  const action = Reflect.getMetadata(REQUIRED_PERMISSION_KEY, ctrl.prototype[method]);
  expect(action, `${ctrl.constructor.name}.${method}`).toEqual([expected]);
}

function requireNone(ctrl: Controller, method: string) {
  const action = Reflect.getMetadata(REQUIRED_PERMISSION_KEY, ctrl.prototype[method]);
  expect(action, `${ctrl.constructor.name}.${method} should be self-service / open`).toBeUndefined();
}

describe('Authorization matrix — employee', () => {
  it('gates reads, creation, updates, and deactivation', () => {
    requireOne(EmployeeController, 'findAll', 'employee.read');
    requireOne(EmployeeController, 'findById', 'employee.read');
    requireOne(EmployeeController, 'create', 'employee.create');
    requireOne(EmployeeController, 'update', 'employee.update');
    requireOne(EmployeeController, 'deactivate', 'employee.deactivate');
  });
});

describe('Authorization matrix — scheduling', () => {
  it('gates schedule reads and creation', () => {
    requireOne(SchedulingController, 'findAll', 'schedule.read');
    requireOne(SchedulingController, 'findById', 'schedule.read');
    requireOne(SchedulingController, 'create', 'schedule.create');
  });

  it('gates employee assignment and publish', () => {
    requireOne(SchedulingController, 'validateAssignment', 'shift.assign');
    requireOne(SchedulingController, 'assign', 'shift.assign');
    requireOne(SchedulingController, 'overrideConflict', 'shift.conflict_override');
    requireOne(SchedulingController, 'publishSchedule', 'schedule.publish');
  });
});

describe('Authorization matrix — attendance', () => {
  it('gates manager views and corrections', () => {
    requireOne(AttendanceController, 'findDailyRecords', 'attendance.read');
    requireOne(AttendanceController, 'findEmployeeRecords', 'attendance.read');
    requireOne(AttendanceController, 'recordCorrection', 'attendance.correct');
  });

  it('leaves clock events open as employee self-service (enforced via self-scope)', () => {
    requireNone(AttendanceController, 'recordClockEvent');
  });
});

describe('Authorization matrix — leave', () => {
  it('gates reads, balances, and approval', () => {
    requireOne(LeaveController, 'getLeaveTypes', 'leave.read');
    requireOne(LeaveController, 'getLeaveRequests', 'leave.read');
    requireOne(LeaveController, 'getBalances', 'leave.read');
    requireOne(LeaveController, 'reviewLeaveRequest', 'leave.approve');
  });

  it('leaves request submission open as employee self-service (enforced via self-scope)', () => {
    requireNone(LeaveController, 'createLeaveRequest');
  });
});

describe('Authorization matrix — company & permissions', () => {
  it('gates company settings changes', () => {
    requireNone(CompanyController, 'getCurrent');
    requireOne(CompanyController, 'updateSettings', 'company.settings.manage');
  });

  it('gates role management and membership privilege inspection', () => {
    requireNone(PermissionsController, 'getRoles');
    requireNone(PermissionsController, 'getPermissions');
    requireOne(PermissionsController, 'createRole', 'role.manage');
    requireOne(PermissionsController, 'getEffectivePermissions', 'role.manage');
    requireOne(PermissionsController, 'getScopes', 'role.manage');
  });
});

describe('Authorization matrix — audit', () => {
  it('gates audit log reads', () => {
    requireOne(AuditController, 'list', 'audit.read');
  });
});

describe('Authorization matrix — catalog consistency', () => {
  it('every required permission maps to a canonical catalog action', () => {
    const controllers: Controller[] = [
      EmployeeController,
      SchedulingController,
      AttendanceController,
      AuditController,
      LeaveController,
      CompanyController,
      PermissionsController,
    ];

    for (const ctrl of controllers) {
      for (const method of Object.getOwnPropertyNames(ctrl.prototype)) {
        if (method === 'constructor') continue;
        const required = Reflect.getMetadata(REQUIRED_PERMISSION_KEY, ctrl.prototype[method]);
        if (!required) continue;

        for (const action of required) {
          const isKnown = (PERMISSION_ACTIONS as readonly string[]).includes(action);
          expect(isKnown, `Unknown permission action '${action}' on ${ctrl.constructor.name}.${method}`).toBe(true);
        }

        // no dangling metadata arrays on non-endpoint helpers
        expect(required.length).toBeGreaterThan(0);
      }
    }
  });
});