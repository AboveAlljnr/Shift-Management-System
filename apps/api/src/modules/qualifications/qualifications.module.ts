import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';

import { QualificationsController } from './qualifications.controller';
import { QualificationsService } from './qualifications.service';

@Module({
  imports: [AuthorizationModule],
  controllers: [QualificationsController],
  providers: [QualificationsService],
  exports: [QualificationsService],
})
export class QualificationsModule {}