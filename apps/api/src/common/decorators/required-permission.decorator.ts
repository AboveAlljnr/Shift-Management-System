import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

/**
 * Restricts an endpoint to memberships whose effective permissions include ALL
 * the given permission actions (`resource.action`, see docs/03-auth/permissions.md).
 *
 * Deny-by-default: it only gates when metadata is present; a missing permission
 * produces HTTP 403 via the global PermissionGuard.
 *
 * Usage: @RequiredPermission('employee.create')
 */
export const RequiredPermission = (...actions: string[]) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, actions);