import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ReportsService } from './reports.service';

@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}
}
