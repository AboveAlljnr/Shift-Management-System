import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { ObservabilityModule } from './common/observability/observability.module';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
// Infrastructure
import { DatabaseModule } from './infrastructure/database/database.module';
import { OptimizerModule } from './infrastructure/optimizer/optimizer.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { StorageModule } from './infrastructure/storage/storage.module';
// Cross-cutting
// Domain modules (Modular Monolith)
import { ActivitiesModule } from './modules/activities/activities.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { BillingModule } from './modules/billing/billing.module';
import { CompanyModule } from './modules/company/company.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { EmployeeModule } from './modules/employee/employee.module';
import { LeaveModule } from './modules/leave/leave.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),

    // Rate limiting
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'medium', ttl: 60_000, limit: 100 },
      { name: 'long', ttl: 3_600_000, limit: 1000 },
    ]),

    // Event system
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),

    // Cron jobs
    ScheduleModule.forRoot(),

    // Infrastructure
    DatabaseModule,
    RedisModule,
    StorageModule,
    OptimizerModule,
    QueueModule,

    // Cross-cutting (structured logging / correlation id)
    ObservabilityModule,

    // Domain modules
    AuthModule,
    AuthorizationModule,
    AvailabilityModule,
    CompanyModule,
    OrganizationModule,
    EmployeeModule,
    PermissionsModule,
    SchedulingModule,
    AttendanceModule,
    LeaveModule,
    ActivitiesModule,
    DocumentsModule,
    NotificationsModule,
    ReportsModule,
    BillingModule,
    AuditModule,
    SuperAdminModule,
    HealthModule,
  ],
  providers: [
    // Apply global rate limiting (short/medium/long configured above). Registered in the root
    // module so it runs before auth guards, meaning login/logout/register attempts are limited
    // even though they are unauthenticated endpoints. See docs/01-architecture/security.md.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
