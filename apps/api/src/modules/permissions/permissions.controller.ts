import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { CompanyId } from '../../common/decorators/current-user.decorator';
import { RequiredPermission } from '../../common/decorators/required-permission.decorator';

import { PermissionsService } from './permissions.service';

@ApiTags('Permissions & Roles')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get('roles')
  @ApiOperation({ summary: 'List roles available to the company' })
  async getRoles(@CompanyId() companyId: string) {
    return this.permissionsService.getRoles(companyId);
  }

  @Post('roles')
  @RequiredPermission('role.manage')
  @ApiOperation({ summary: 'Create a custom role' })
  async createRole(
    @CompanyId() companyId: string,
    @Body() body: { name: string; code: string; description?: string; permissionIds: string[] },
  ) {
    return this.permissionsService.createRole(companyId, body);
  }

  @Get('catalog')
  @ApiOperation({ summary: 'List all granular system permissions' })
  async getPermissions() {
    return this.permissionsService.getPermissions();
  }

  @Get('effective/:membershipId')
  @RequiredPermission('role.manage')
  @ApiOperation({ summary: 'Get calculated effective permissions for a membership' })
  async getEffectivePermissions(@CompanyId() companyId: string, @Param('membershipId') membershipId: string) {
    await this.assertMembershipInCompany(membershipId, companyId);
    return this.permissionsService.getEffectivePermissions(membershipId);
  }

  @Get('scopes/:membershipId')
  @RequiredPermission('role.manage')
  @ApiOperation({ summary: 'Get assigned organizational access scopes for a membership' })
  async getScopes(@CompanyId() companyId: string, @Param('membershipId') membershipId: string) {
    await this.assertMembershipInCompany(membershipId, companyId);
    return this.permissionsService.resolveScopes(membershipId);
  }

  /**
   * Prevents cross-tenant privilege inspection: the target membership must
   * belong to the caller's own company.
   */
  private async assertMembershipInCompany(membershipId: string, companyId: string): Promise<void> {
    const membership = await this.permissionsService['prisma'].companyMembership.findFirst({
      where: { id: membershipId, companyId },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException('Membership does not belong to your company');
    }
  }
}
