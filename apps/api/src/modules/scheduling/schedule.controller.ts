import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  CreateScheduleSchema,
  PublishScheduleSchema,
} from '@sms/shared';
import type {
  CreateScheduleDto,
  PublishScheduleDto,
  User,
} from '@sms/shared';

import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermission } from '../../common/decorators/required-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { SchedulingService } from './scheduling.service';

@ApiTags('Schedules')
@ApiBearerAuth()
@Controller('schedules')
export class ScheduleController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Get()
  @RequiredPermission('schedule.read')
  @ApiOperation({ summary: 'List schedules (optionally by branch / date window)' })
  async findAll(
    @CompanyId() companyId: string,
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.schedulingService.findSchedules(
      companyId,
      { branchId, startDate, endDate },
      user?.membershipId ?? '',
    );
  }

  @Post()
  @RequiredPermission('schedule.create')
  @ApiOperation({ summary: 'Create a draft schedule for a period' })
  async create(
    @CompanyId() companyId: string,
    @Body(new ZodValidationPipe(CreateScheduleSchema)) dto: CreateScheduleDto,
    @CurrentUser() user: User,
  ) {
    return this.schedulingService.createSchedule(companyId, dto, user.id);
  }

  @Get(':id/versions')
  @RequiredPermission('schedule.read')
  @ApiOperation({ summary: 'List immutable publish versions / history for a schedule' })
  async versions(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.schedulingService.findScheduleVersions(
      companyId,
      id,
      user?.membershipId ?? '',
    );
  }

  @Post(':id/publish')
  @RequiredPermission('schedule.publish')
  @ApiOperation({ summary: 'Publish a schedule and create an immutable version snapshot' })
  async publish(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PublishScheduleSchema.partial())) dto: PublishScheduleDto,
    @CurrentUser() user: User,
  ) {
    return this.schedulingService.publishSchedule(companyId, id, user.id, dto.notes);
  }

  @Get('coverage')
  @RequiredPermission('schedule.read')
  @ApiOperation({ summary: 'Compute staffing coverage (headcount filled vs required) for shifts' })
  async coverage(
    @CompanyId() companyId: string,
    @Query('shiftIds') shiftIds?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    const ids = (shiftIds ?? '').split(',').filter(Boolean);
    return this.schedulingService.coverage(companyId, ids, user?.membershipId ?? '');
  }
}
