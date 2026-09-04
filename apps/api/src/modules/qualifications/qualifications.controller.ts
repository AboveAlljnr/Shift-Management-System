import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Param,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  CreateCertificationSchema,
  CreateSkillSchema,
  SetEmployeeCertificationsSchema,
  SetEmployeeSkillsSchema,
  UpdateCertificationSchema,
  UpdateSkillSchema,
} from '@sms/shared';
import type {
  CreateCertificationDto,
  CreateSkillDto,
  SetEmployeeCertificationsDto,
  SetEmployeeSkillsDto,
  UpdateCertificationDto,
  UpdateSkillDto,
} from '@sms/shared';

import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermission } from '../../common/decorators/required-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { QualificationsService } from './qualifications.service';

@ApiTags('Qualifications')
@ApiBearerAuth()
@Controller('qualifications')
export class QualificationsController {
  constructor(private readonly qualificationsService: QualificationsService) {}

  @Get('skills')
  @RequiredPermission('employee.read')
  @ApiOperation({ summary: 'List company skill catalog' })
  async listSkills(@CompanyId() companyId: string) {
    return this.qualificationsService.listSkills(companyId);
  }

  @Post('skills')
  @RequiredPermission('employee.update')
  @ApiOperation({ summary: 'Create a skill in the company catalog' })
  async createSkill(
    @CompanyId() companyId: string,
    @Body(new ZodValidationPipe(CreateSkillSchema)) dto: CreateSkillDto,
  ) {
    return this.qualificationsService.createSkill(companyId, dto);
  }

  @Patch('skills/:id')
  @RequiredPermission('employee.update')
  @ApiOperation({ summary: 'Update (or archive) a skill' })
  async updateSkill(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSkillSchema)) dto: UpdateSkillDto,
  ) {
    return this.qualificationsService.updateSkill(companyId, id, dto);
  }

  @Get('certifications')
  @RequiredPermission('employee.read')
  @ApiOperation({ summary: 'List company certification catalog' })
  async listCertifications(@CompanyId() companyId: string) {
    return this.qualificationsService.listCertifications(companyId);
  }

  @Post('certifications')
  @RequiredPermission('employee.update')
  @ApiOperation({ summary: 'Create a certification in the company catalog' })
  async createCertification(
    @CompanyId() companyId: string,
    @Body(new ZodValidationPipe(CreateCertificationSchema)) dto: CreateCertificationDto,
  ) {
    return this.qualificationsService.createCertification(companyId, dto);
  }

  @Patch('certifications/:id')
  @RequiredPermission('employee.update')
  @ApiOperation({ summary: 'Update (or archive) a certification' })
  async updateCertification(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCertificationSchema)) dto: UpdateCertificationDto,
  ) {
    return this.qualificationsService.updateCertification(companyId, id, dto);
  }

  @Get('employees/:employeeId')
  @RequiredPermission('employee.read')
  @ApiOperation({ summary: 'Get an employee\'s skills and certifications' })
  async getEmployeeQualifications(
    @CompanyId() companyId: string,
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.qualificationsService.getEmployeeQualifications(
      companyId,
      employeeId,
      user.membershipId ?? '',
    );
  }

  @Put('employees/:employeeId/skills')
  @RequiredPermission('employee.update')
  @ApiOperation({ summary: 'Replace an employee\'s skills with the provided set' })
  async setEmployeeSkills(
    @CompanyId() companyId: string,
    @Param('employeeId') employeeId: string,
    @Body(new ZodValidationPipe(SetEmployeeSkillsSchema)) dto: SetEmployeeSkillsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.qualificationsService.setEmployeeSkills(
      companyId,
      employeeId,
      dto,
      user.membershipId ?? '',
    );
  }

  @Put('employees/:employeeId/certifications')
  @RequiredPermission('employee.update')
  @ApiOperation({ summary: 'Replace an employee\'s certifications with the provided set' })
  async setEmployeeCertifications(
    @CompanyId() companyId: string,
    @Param('employeeId') employeeId: string,
    @Body(new ZodValidationPipe(SetEmployeeCertificationsSchema)) dto: SetEmployeeCertificationsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.qualificationsService.setEmployeeCertifications(
      companyId,
      employeeId,
      dto,
      user.membershipId ?? '',
    );
  }
}