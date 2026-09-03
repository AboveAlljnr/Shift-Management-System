import {
  Controller,
  Get,
  Post,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';

import { OrganizationService } from './organization.service';

@ApiTags('Organization')
@ApiBearerAuth()
@Controller('organization')
export class OrganizationController {
  constructor(private readonly orgService: OrganizationService) {}

  @Get('branches')
  @ApiOperation({ summary: 'List all branches with departments and teams' })
  async getBranches(
    @CompanyId() companyId: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.orgService.getBranches(companyId, user?.membershipId ?? '');
  }

  @Post('branches')
  @ApiOperation({ summary: 'Create a new branch' })
  async createBranch(
    @CompanyId() companyId: string,
    @Body() body: { name: string; code: string; timezone?: string; address?: string },
  ) {
    return this.orgService.createBranch(companyId, body);
  }

  @Get('departments')
  @ApiOperation({ summary: 'List departments with optional branch filter' })
  async getDepartments(
    @CompanyId() companyId: string,
    @Query('branchId') branchId?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.orgService.getDepartments(companyId, branchId, user?.membershipId ?? '');
  }

  @Post('departments')
  @ApiOperation({ summary: 'Create a new department under a branch' })
  async createDepartment(
    @CompanyId() companyId: string,
    @Body() body: { branchId: string; name: string; code: string; managerId?: string },
  ) {
    return this.orgService.createDepartment(companyId, body);
  }

  @Get('teams')
  @ApiOperation({ summary: 'List teams with optional department filter' })
  async getTeams(
    @CompanyId() companyId: string,
    @Query('departmentId') departmentId?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.orgService.getTeams(companyId, departmentId, user?.membershipId ?? '');
  }

  @Post('teams')
  @ApiOperation({ summary: 'Create a new team under a department' })
  async createTeam(
    @CompanyId() companyId: string,
    @Body() body: { departmentId: string; name: string; code: string; managerId?: string },
  ) {
    return this.orgService.createTeam(companyId, body);
  }

  @Get('positions')
  @ApiOperation({ summary: 'List company positions' })
  async getPositions(
    @CompanyId() companyId: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.orgService.getPositions(companyId, user?.membershipId ?? '');
  }

  @Get('employment-types')
  @ApiOperation({ summary: 'List company employment types' })
  async getEmploymentTypes(@CompanyId() companyId: string) {
    return this.orgService.getEmploymentTypes(companyId);
  }
}
