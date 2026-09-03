import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@sms/shared';

export const ROLES_KEY = 'roles';

/**
 * Restricts endpoint access to the specified roles.
 * Usage: @Roles('admin', 'manager')
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks an endpoint as public (no JWT required).
 * Usage: @Public()
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
