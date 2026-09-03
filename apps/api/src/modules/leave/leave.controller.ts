import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CreateLeaveRequestSchema, ReviewLeaveSchema } from '@sms/shared';
import type { CreateLeaveRequestDto, ReviewLeaveDto, User } from '@sms/shared';

import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermission } from '../../common/decorators/required-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { LeaveService } from './leave.service';

@ApiTags('Leave')
@ApiBearerAuth()
@Controller('leave')
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  @Get('types')
  @RequiredPermission('leave.read')
  @ApiOperation({ summary: 'List available leave types' })
  async getLeaveTypes(@CompanyId() companyId: string) {
    return this.leaveService.getLeaveTypes(companyId);
  }

  @Get('requests')
  @RequiredPermission('leave.read')
  @ApiOperation({ summary: 'List leave requests' })
  async getLeaveRequests(
    @CompanyId() companyId: string,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.leaveService.getLeaveRequests(
      companyId,
      { employeeId, status, startDate },
      user?.membershipId ?? '',
    );
  }

  @Post('requests')
  @ApiOperation({ summary: 'Submit a new leave request' })
  async createLeaveRequest(
    @CompanyId() companyId: string,
    @Body(new ZodValidationPipe(CreateLeaveRequestSchema)) dto: CreateLeaveRequestDto,
    @CurrentUser() user: User,
  ) {
    // Self-scope (ADR-003): employees request leave only for their own linked profile.
    const employee = await this.leaveService['prisma'].employee.findFirst({
      where: { userId: user.id, companyId },
    });
    if (!employee) {
      throw new ForbiddenException('No employee profile is linked to this account');
    }

    return this.leaveService.createLeaveRequest(companyId, employee.id, dto);
  }

  @Post('requests/:id/review')
  @RequiredPermission('leave.approve')
  @ApiOperation({ summary: 'Approve or reject a leave request' })
  async reviewLeaveRequest(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewLeaveSchema)) dto: ReviewLeaveDto,
    @CurrentUser() user: User,
  ) {
    return this.leaveService.reviewLeaveRequest(companyId, id, dto, user.id);
  }

  @Get('balances/:employeeId')
  @RequiredPermission('leave.read')
  @ApiOperation({ summary: 'Get employee leave balance' })
  async getBalances(
    @CompanyId() companyId: string,
    @Param('employeeId') employeeId: string,
    @Query('year') year?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.leaveService.getBalances(
      companyId,
      employeeId,
      year ? parseInt(year, 10) : undefined,
      user?.membershipId ?? '',
    );
  }
}
