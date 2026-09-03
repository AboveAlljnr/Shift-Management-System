import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ActivitiesService } from './activities.service';

@ApiTags('Activities')
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}
}
