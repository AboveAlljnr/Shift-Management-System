import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { PrismaService } from '../infrastructure/database/prisma.service';

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  checks: {
    api: { status: 'ok' };
    database: { status: 'ok' | 'down'; latencyMs?: number };
    redis: { status: 'ok' | 'down'; latencyMs?: number };
  };
  timestamp: string;
}

/**
 * Liveness/readiness checks for the API (deployment/CI health probes).
 *
 *  - Liveness: the process is up and serving (always "ok" once reachable).
 *  - Readiness: the API can reach Postgres (SELECT 1) and Redis (PING). If a dependency is
 *    unreachable the endpoint reports 503 so orchestrators stop routing traffic to it.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async readiness(): Promise<HealthStatus> {
    const checks: HealthStatus['checks'] = {
      api: { status: 'ok' },
      database: { status: 'down' },
      redis: { status: 'down' },
    };

    try {
      const started = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'ok', latencyMs: Date.now() - started };
    } catch (err) {
      this.logger.error('Health check: database unreachable', err instanceof Error ? err.message : String(err));
    }

    try {
      checks.redis = await this.pingRedis() ? { status: 'ok', latencyMs: 0 } : checks.redis;
    } catch (err) {
      this.logger.error('Health check: redis unreachable', err instanceof Error ? err.message : String(err));
    }

    const allUp = checks.api.status === 'ok' && checks.database.status === 'ok' && checks.redis.status === 'ok';
    const anyUp = checks.api.status === 'ok' && (checks.database.status === 'ok' || checks.redis.status === 'ok');

    return {
      status: allUp ? 'ok' : anyUp ? 'degraded' : 'down',
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  private async pingRedis(): Promise<boolean> {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    const client = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 1000,
      maxRetriesPerRequest: 1,
      retryStrategy: undefined,
    });
    try {
      await client.connect();
      const pong = await client.ping();
      return pong === 'PONG';
    } finally {
      await client.quit().catch(() => undefined);
    }
  }
}
