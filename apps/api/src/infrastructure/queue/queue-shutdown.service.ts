import { getQueueToken } from '@nestjs/bull';
import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { QUEUE_NAMES } from '@sms/shared';
import type { Queue } from 'bull';

const SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * Graceful shutdown for BullMQ (HIGH #4). Bull's `forRootAsync` opens its own ioredis
 * connections; closing each registered queue flushes those connections so the container exits
 * cleanly instead of being hard-killed. Bounded by a timeout so shutdown never hangs.
 */
@Injectable()
export class QueueShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueShutdownService.name);

  constructor(
    @Inject(getQueueToken(QUEUE_NAMES.NOTIFICATIONS)) private readonly notificationsQueue: Queue,
    @Inject(getQueueToken(QUEUE_NAMES.REPORTS)) private readonly reportsQueue: Queue,
    @Inject(getQueueToken(QUEUE_NAMES.SCHEDULE_OPTIMIZATION)) private readonly scheduleQueue: Queue,
    @Inject(getQueueToken(QUEUE_NAMES.DOCUMENT_EXPIRY)) private readonly documentQueue: Queue,
    @Inject(getQueueToken(QUEUE_NAMES.BILLING_RETRY)) private readonly billingQueue: Queue,
    @Inject(getQueueToken(QUEUE_NAMES.AUDIT_RETENTION)) private readonly auditQueue: Queue,
    @Inject(getQueueToken(QUEUE_NAMES.OFFLINE_RECONCILIATION)) private readonly offlineQueue: Queue,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    const queues = [
      this.notificationsQueue,
      this.reportsQueue,
      this.scheduleQueue,
      this.documentQueue,
      this.billingQueue,
      this.auditQueue,
      this.offlineQueue,
    ];

    try {
      await Promise.race([
        Promise.all(queues.map((q) => q.close())),
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
      ]);
      this.logger.log('BullMQ queues closed cleanly');
    } catch (err) {
      this.logger.error(
        'Error closing BullMQ queues during shutdown',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
