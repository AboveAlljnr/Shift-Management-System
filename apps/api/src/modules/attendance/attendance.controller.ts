import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AttendanceCorrectionSchema, ClockEventSchema } from '@sms/shared';
import type { ClockEventDto, AttendanceCorrectionDto, User } from '@sms/shared';

import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermission } from '../../common/decorators/required-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { AttendanceService } from './attendance.service';

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('events')
  @ApiOperation({ summary: 'Record clock in/out or break event (supports offline sync with idempotency)' })
  async recordClockEvent(
    @CompanyId() companyId: string,
    @Body(new ZodValidationPipe(ClockEventSchema)) dto: ClockEventDto,
    @CurrentUser() user: User,
  ) {
    // Self-scope (ADR-003): employees clock only for their own linked profile.
    const employee = await this.attendanceService['prisma'].employee.findFirst({
      where: { userId: user.id, companyId },
    });
    if (!employee) {
      throw new ForbiddenException('No employee profile is linked to this account');
    }

    return this.attendanceService.recordClockEvent(companyId, employee.id, dto);
  }

  @Get('me/geofence')
  @ApiOperation({ summary: 'Self-scoped geofence status for the linked employee profile' })
  async getMyGeofenceStatus(
    @CompanyId() companyId: string,
    @CurrentUser() user: User,
  ) {
    return this.attendanceService.getMyGeofenceStatus(companyId, user.id);
  }

  @Post('corrections')
  @RequiredPermission('attendance.correct')
  @ApiOperation({ summary: 'Manager correction of an attendance record with mandatory audit reason' })
  async recordCorrection(
    @CompanyId() companyId: string,
    @Body(new ZodValidationPipe(AttendanceCorrectionSchema)) dto: AttendanceCorrectionDto,
    @CurrentUser() user: User,
  ) {
    return this.attendanceService.recordCorrection(companyId, dto, user.id);
  }

  @Get('daily')
  @RequiredPermission('attendance.read')
  @ApiOperation({ summary: 'Get daily normalized attendance overview for company / branch' })
  async findDailyRecords(
    @CompanyId() companyId: string,
    @Query('date') date: string,
    @Query('branchId') branchId?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    const membershipId = user?.membershipId ?? '';
    return this.attendanceService.findDailyRecords(companyId, date, branchId, membershipId);
  }

  @Get('employee/:employeeId')
  @RequiredPermission('attendance.read')
  @ApiOperation({ summary: 'Get employee attendance history' })
  async findEmployeeRecords(
    @CompanyId() companyId: string,
    @Param('employeeId') employeeId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.attendanceService.findEmployeeRecords(
      companyId,
      employeeId,
      startDate,
      endDate,
      user?.membershipId ?? '',
    );
  }
}
