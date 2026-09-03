import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthorizationService } from './authorization.service';
import { PermissionGuard } from './permission.guard';
import { ScopeFilterService } from './scope-filter.service';
import { ScopeResolver } from './scope-resolver.service';

/**
 * Central authorization (ADR-003): PermissionGuard gates every endpoint that
 * carries @RequiredPermission(...) metadata; decision logic lives in
 * AuthorizationService + ScopeResolver. ScopeFilterService turns granted
 * scopes into service-layer row filters for list/read queries.
 */
@Module({
  providers: [
    ScopeResolver,
    AuthorizationService,
    ScopeFilterService,
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [ScopeResolver, AuthorizationService, ScopeFilterService],
})
export class AuthorizationModule {}