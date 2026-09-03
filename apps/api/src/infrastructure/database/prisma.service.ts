import type { OnApplicationShutdown, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { parseDbConnectPolicy } from './db-connect-policy';
import { DbConnectRetrier } from './db-connect-retrier';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly connectRetrier: DbConnectRetrier;
  private readonly abortSignal = () => this.shuttingDown;

  private shuttingDown = false;

  constructor(config: ConfigService) {
    super();
    const policy = parseDbConnectPolicy({
      DB_CONNECT_MAX_RETRIES: config.get('DB_CONNECT_MAX_RETRIES'),
      DB_CONNECT_INITIAL_DELAY_MS: config.get('DB_CONNECT_INITIAL_DELAY_MS'),
      DB_CONNECT_MAX_DELAY_MS: config.get('DB_CONNECT_MAX_DELAY_MS'),
    });
    this.connectRetrier = new DbConnectRetrier({
      policy,
      logger: this.logger,
      shouldAbort: this.abortSignal,
    });
    // Abort a pending startup retry promptly when the process receives a termination signal, so
    // graceful shutdown is not blocked behind a long DB backoff.
    process.once('SIGTERM', () => {
      this.shuttingDown = true;
    });
    process.once('SIGINT', () => {
      this.shuttingDown = true;
    });
  }

  async onModuleInit() {
    await this.connectRetrier.connect(() => this.$connect());
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
