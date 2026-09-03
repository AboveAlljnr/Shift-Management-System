import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';

import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';

@Module({
  imports: [AuthorizationModule],
  controllers: [EmployeeController],
  providers: [EmployeeService],
  exports: [EmployeeService],
})
export class EmployeeModule {}
