import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';

import { Public } from '../common/decorators/roles.decorator';

import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness probe: the process is up and serving. No dependency check. */
  @Public()
  @Get('live')
  @HttpCode(HttpStatus.OK)
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness probe: API can reach DB and Redis. 503 when a dependency is down. */
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  async ready() {
    const result = await this.health.readiness();
    if (result.status === 'down') {
      throw new ServiceUnavailableException(result);
    }
    return result;
  }
}
