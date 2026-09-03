import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { User, CompanyContext as ICompanyContext } from '@sms/shared';
import type { Request } from 'express';

/**
 * Authenticated principal attached to the request by the global JWT guard.
 * Extends the shared `User` type with the active-company auth context resolved
 * server-side (ADR-004).
 */
export interface AuthUser extends User {
  companyId?: string;
  membershipId?: string;
  roles?: string[];
  role?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  companyContext?: ICompanyContext;
  companyId?: string;
  membershipId?: string;
}

/**
 * Extracts the authenticated user from the request.
 * Usage: @CurrentUser() user: AuthUser
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);

/**
 * Extracts the active company ID from the request context.
 * Usage: @CompanyId() companyId: string
 */
export const CompanyId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return (
      request.companyId ||
      request.user?.companyId ||
      (request.companyContext?.companyId as string)
    );
  },
);

/**
 * Extracts the full CompanyContext (roles, permissions, scopes) from the request.
 * Usage: @CompanyContext() context: ICompanyContext
 */
export const CompanyContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ICompanyContext | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.companyContext;
  },
);
