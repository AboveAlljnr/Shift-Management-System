import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { SuperAdminService } from './super-admin.service';

@ApiTags('SuperAdmin')
@Controller('super-admin')
export class SuperAdminController {
  constructor(private readonly superAdminService: SuperAdminService) {}
}
