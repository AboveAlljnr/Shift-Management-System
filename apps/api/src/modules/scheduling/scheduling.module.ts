import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';

import { ScheduleController } from './schedule.controller';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';

@Module({
  imports: [AuthorizationModule],
  controllers: [SchedulingController, ScheduleController],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
