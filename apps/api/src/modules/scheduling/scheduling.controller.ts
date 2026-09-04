import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  AssignShiftSchema,
  CreateShiftSchema,
  OpenShiftReviewSchema,
  OptimizeApplySchema,
  OptimizeScheduleSchema,
  SetShiftRequirementsSchema,
  ShiftConflictOverrideSchema,
  SwapRequestSchema,
  SwapRespondSchema,
  SwapReviewSchema,
} from '@sms/shared';
import type {
  CreateShiftDto,
  AssignShiftDto,
  ShiftConflictOverrideDto,
  OptimizeApplyDto,
  OptimizeScheduleDto,
  OpenShiftReviewDto,
  SetShiftRequirementsDto,
  SwapRequestDto,
  SwapRespondDto,
  SwapReviewDto,
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

@ApiTags('Scheduling')
@ApiBearerAuth()
@Controller('shifts')
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Get()
  @RequiredPermission('schedule.read')
  @ApiOperation({ summary: 'List shifts with optional filters (branch, department, date range)' })
  async findAll(
    @CompanyId() companyId: string,
    @Query('branchId') branchId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('isOpen') isOpen?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.schedulingService.findAll(
      companyId,
      {
        branchId,
        departmentId,
        startDate,
        endDate,
        status,
        isOpen: typeof isOpen === 'undefined' ? undefined : isOpen === 'true',
      },
      user?.membershipId ?? '',
    );
  }

  @Get('my-requests')
  @RequiredPermission('schedule.read')
  @ApiOperation({ summary: 'Current employee\'s own open-shift and swap requests (self-service ledger)' })
  async findMyRequests(
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.schedulingService.findMyRequests(companyId, user.id);
  }

  @Get('open-requests')
  @RequiredPermission('schedule.read')
  @ApiOperation({ summary: 'List open-shift requests for review' })
  async listOpenShiftRequests(@CompanyId() companyId: string) {
    return this.schedulingService.listOpenShiftRequests(companyId);
  }

  @Get('swaps')
  @RequiredPermission('schedule.read')
  @ApiOperation({ summary: 'List shift swap requests for review' })
  async listSwapRequests(@CompanyId() companyId: string) {
    return this.schedulingService.listSwapRequests(companyId);
  }

  @Get(':id')
  @RequiredPermission('schedule.read')
  @ApiOperation({ summary: 'Get shift details including requirements, assignments, and overrides' })
  async findById(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.schedulingService.findById(companyId, id, user?.membershipId ?? '');
  }

  @Post()
  @RequiredPermission('schedule.create')
  @ApiOperation({ summary: 'Create a new shift with optional requirements' })
  async create(
    @CompanyId() companyId: string,
    @Body(new ZodValidationPipe(CreateShiftSchema)) dto: CreateShiftDto,
  ) {
    return this.schedulingService.create(companyId, dto);
  }

  @Patch(':id/requirements')
  @RequiredPermission('shift.assign')
  @ApiOperation({ summary: 'Replace a shift\'s coverage requirements (headcount, skills, certifications)' })
  async setRequirements(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetShiftRequirementsSchema)) dto: SetShiftRequirementsDto,
    @CurrentUser() user: User,
  ) {
    return this.schedulingService.setShiftRequirements(companyId, id, dto, user.id);
  }

  @Post('optimize')
  @RequiredPermission('schedule.create')
  @ApiOperation({ summary: 'Generate suggested schedule via the optimizer (review-first, no writes' })
  async optimize(
    @CompanyId() companyId: string,
    @Body(new ZodValidationPipe(OptimizeScheduleSchema)) dto: OptimizeScheduleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.schedulingService.generateSuggestions(
      companyId,
      dto,
      user.id,
      user.membershipId ?? '',
    );
  }

  @Post('optimize/apply')
  @RequiredPermission('schedule.create')
  @ApiOperation({ summary: 'Apply previously proposed schedule suggestions (transactional revalidation)' })
  async optimizeApply(
    @CompanyId() companyId: string,
    @Body(new ZodValidationPipe(OptimizeApplySchema)) dto: OptimizeApplyDto,
    @CurrentUser() user: User,
  ) {
    return this.schedulingService.applySuggestions(companyId, dto, user.id);
  }

  @Post(':id/validate-assignment')
  @RequiredPermission('shift.assign')
  @ApiOperation({ summary: 'Validate employee assignment against deterministic conflict rules' })
  async validateAssignment(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body('employeeId') employeeId: string,
  ) {
    return this.schedulingService.validateAssignment(companyId, id, employeeId);
  }

  @Post(':id/assign')
  @RequiredPermission('shift.assign')
  @ApiOperation({ summary: 'Assign employee to shift (fails if blocking conflict or warning present)' })
  async assign(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AssignShiftSchema)) dto: AssignShiftDto,
    @CurrentUser() user: User,
  ) {
    return this.schedulingService.assign(companyId, id, dto, user.id);
  }

  @Post(':id/override-conflict')
  @RequiredPermission('shift.conflict_override')
  @ApiOperation({ summary: 'Assign employee to shift with an explicit manager conflict override' })
  async overrideConflict(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ShiftConflictOverrideSchema.omit({ shiftId: true }))) dto: ShiftConflictOverrideDto,
    @CurrentUser() user: User,
  ) {
    return this.schedulingService.overrideConflictAndAssign(
      companyId,
      { ...dto, shiftId: id },
      user.id,
    );
  }

  @Post('schedules/:scheduleId/publish')
  @RequiredPermission('schedule.publish')
  @ApiOperation({ summary: 'Publish schedule and create an immutable version snapshot' })
  async publishSchedule(
    @CompanyId() companyId: string,
    @Param('scheduleId') scheduleId: string,
    @Body('notes') notes: string | undefined,
    @CurrentUser() user: User,
  ) {
    return this.schedulingService.publishSchedule(companyId, scheduleId, user.id, notes);
  }

  @Post(':id/open')
  @RequiredPermission('shift.assign')
  @ApiOperation({ summary: 'Mark a shift as open (or close it) so employees can self-request it' })
  async setShiftOpen(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body('isOpen') isOpen: boolean,
    @CurrentUser() user: User,
  ) {
    return this.schedulingService.setShiftOpen(companyId, id, isOpen === true, user.id);
  }

  @Post(':id/open-request')
  @RequiredPermission('schedule.read')
  @ApiOperation({ summary: 'Request an open shift (employee self-service, qualification-gated)' })
  async requestOpenShift(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body('note') note: string | undefined,
    @CurrentUser() user: User,
  ) {
    return this.schedulingService.requestOpenShift(companyId, { shiftId: id, note }, user.id);
  }

  @Post('open-requests/:requestId/review')
  @RequiredPermission('shift.assign')
  @ApiOperation({ summary: 'Approve or reject an open-shift request' })
  async reviewOpenShiftRequest(
    @CompanyId() companyId: string,
    @Param('requestId') requestId: string,
    @Body(new ZodValidationPipe(OpenShiftReviewSchema)) dto: OpenShiftReviewDto,
    @CurrentUser() user: User,
  ) {
    return this.schedulingService.reviewOpenShiftRequest(companyId, requestId, dto, user.id);
  }

  @Post('swap-requests')
  @RequiredPermission('schedule.read')
  @ApiOperation({ summary: 'Request a shift swap (employee self-service)' })
  async requestSwap(
    @CompanyId() companyId: string,
    @Body(new ZodValidationPipe(SwapRequestSchema)) dto: SwapRequestDto,
    @CurrentUser() user: User,
  ) {
    return this.schedulingService.requestSwap(companyId, dto, user.id);
  }

  @Post('swaps/:requestId/respond')
  @RequiredPermission('schedule.read')
  @ApiOperation({ summary: 'Accept or reject an incoming swap request (employee self-service)' })
  async respondSwap(
    @CompanyId() companyId: string,
    @Param('requestId') requestId: string,
    @Body(new ZodValidationPipe(SwapRespondSchema)) dto: SwapRespondDto,
    @CurrentUser() user: User,
  ) {
    return this.schedulingService.respondSwap(companyId, requestId, dto, user.id);
  }

  @Post('swaps/:requestId/review')
  @RequiredPermission('shift.assign')
  @ApiOperation({ summary: 'Approve or reject an accepted swap (manager)' })
  async reviewSwap(
    @CompanyId() companyId: string,
    @Param('requestId') requestId: string,
    @Body(new ZodValidationPipe(SwapReviewSchema)) dto: SwapReviewDto,
    @CurrentUser() user: User,
  ) {
    return this.schedulingService.reviewSwap(companyId, requestId, dto, user.id);
  }
}
