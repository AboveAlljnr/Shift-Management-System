import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  CreateEmployeeSchema,
  PaginationQuerySchema,
  UpdateEmployeeSchema,
} from '@sms/shared';
import type {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  PaginationQueryDto,
} from '@sms/shared';

import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermission } from '../../common/decorators/required-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { EmployeeService } from './employee.service';

@ApiTags('Employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Get()
  @RequiredPermission('employee.read')
  @ApiOperation({ summary: 'List employees with pagination and filters' })
  async findAll(
    @CompanyId() companyId: string,
    @Query(new ZodValidationPipe(PaginationQuerySchema)) query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.employeeService.findAll(companyId, query, user.membershipId ?? '');
  }

  @Get(':id')
  @RequiredPermission('employee.read')
  @ApiOperation({ summary: 'Get employee details by ID' })
  async findById(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.employeeService.findById(companyId, id, user.membershipId ?? '');
  }

  @Post()
  @RequiredPermission('employee.create')
  @ApiOperation({ summary: 'Create a new employee profile' })
  async create(
    @CompanyId() companyId: string,
    @Body(new ZodValidationPipe(CreateEmployeeSchema)) dto: CreateEmployeeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.employeeService.create(companyId, dto, user.membershipId ?? '');
  }

  @Patch(':id')
  @RequiredPermission('employee.update')
  @ApiOperation({ summary: 'Update an existing employee' })
  async update(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEmployeeSchema)) dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.employeeService.update(companyId, id, dto, user.membershipId ?? '');
  }

  @Delete(':id')
  @RequiredPermission('employee.deactivate')
  @ApiOperation({ summary: 'Deactivate an employee' })
  async deactivate(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.employeeService.deactivate(companyId, id, user.membershipId ?? '');
  }
}
