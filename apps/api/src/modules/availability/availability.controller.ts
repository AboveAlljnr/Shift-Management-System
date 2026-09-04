import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  CreateAvailabilityRuleSchema,
  UpdateAvailabilityRuleSchema,
  CreateAvailabilityExceptionSchema,
  UpdateAvailabilityExceptionSchema,
} from '@sms/shared';
import type {
  CreateAvailabilityRuleDto,
  UpdateAvailabilityRuleDto,
  CreateAvailabilityExceptionDto,
  UpdateAvailabilityExceptionDto,
} from '@sms/shared';

import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermission } from '../../common/decorators/required-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { AvailabilityService } from './availability.service';

@ApiTags('Availability')
@ApiBearerAuth()
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  // ---- Rules ----

  @Get('rules')
  @RequiredPermission('availability.read')
  @ApiOperation({ summary: 'List recurring availability rules (scoped by employee/org)' })
  async listRules(
    @CompanyId() companyId: string,
    @Query('employeeId') employeeId?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.availabilityService.listRules(companyId, employeeId, user?.membershipId ?? '');
  }

  @Post('rules')
  @RequiredPermission('availability.manage')
  @ApiOperation({ summary: 'Create a recurring availability rule' })
  async createRule(
    @CompanyId() companyId: string,
    @Body(new ZodValidationPipe(CreateAvailabilityRuleSchema)) dto: CreateAvailabilityRuleDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.availabilityService.createRule(companyId, dto, user?.membershipId ?? '');
  }

  @Patch('rules/:id')
  @RequiredPermission('availability.manage')
  @ApiOperation({ summary: 'Update an availability rule' })
  async updateRule(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateAvailabilityRuleSchema)) dto: UpdateAvailabilityRuleDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.availabilityService.updateRule(companyId, id, dto, user?.membershipId ?? '');
  }

  @Delete('rules/:id')
  @RequiredPermission('availability.manage')
  @ApiOperation({ summary: 'Delete an availability rule' })
  async deleteRule(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.availabilityService.deleteRule(companyId, id, user?.membershipId ?? '');
  }

  // ---- Exceptions ----

  @Get('exceptions')
  @RequiredPermission('availability.read')
  @ApiOperation({ summary: 'List one-off availability exceptions (scoped)' })
  async listExceptions(
    @CompanyId() companyId: string,
    @Query('employeeId') employeeId?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.availabilityService.listExceptions(companyId, employeeId, user?.membershipId ?? '');
  }

  @Post('exceptions')
  @RequiredPermission('availability.manage')
  @ApiOperation({ summary: 'Create a one-off availability exception' })
  async createException(
    @CompanyId() companyId: string,
    @Body(new ZodValidationPipe(CreateAvailabilityExceptionSchema)) dto: CreateAvailabilityExceptionDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.availabilityService.createException(companyId, dto, user?.membershipId ?? '');
  }

  @Patch('exceptions/:id')
  @RequiredPermission('availability.manage')
  @ApiOperation({ summary: 'Update an availability exception' })
  async updateException(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateAvailabilityExceptionSchema)) dto: UpdateAvailabilityExceptionDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.availabilityService.updateException(companyId, id, dto, user?.membershipId ?? '');
  }

  @Delete('exceptions/:id')
  @RequiredPermission('availability.manage')
  @ApiOperation({ summary: 'Delete an availability exception' })
  async deleteException(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.availabilityService.deleteException(companyId, id, user?.membershipId ?? '');
  }
}
