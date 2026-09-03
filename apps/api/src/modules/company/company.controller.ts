import { Controller, Get, Patch, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { CompanyId } from '../../common/decorators/current-user.decorator';
import { RequiredPermission } from '../../common/decorators/required-permission.decorator';

import { CompanyService } from './company.service';

@ApiTags('Companies')
@ApiBearerAuth()
@Controller('companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get('current')
  @ApiOperation({ summary: 'Get current company details' })
  async getCurrent(@CompanyId() companyId: string) {
    return this.companyService.findById(companyId);
  }

  @Patch('settings')
  @RequiredPermission('company.settings.manage')
  @ApiOperation({ summary: 'Update company settings' })
  async updateSettings(
    @CompanyId() companyId: string,
    @Body() body: { settings: Record<string, any> },
  ) {
    return this.companyService.updateSettings(companyId, body.settings);
  }
}
