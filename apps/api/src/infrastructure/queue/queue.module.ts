import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@sms/shared';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.NOTIFICATIONS },
      { name: QUEUE_NAMES.REPORTS },
      { name: QUEUE_NAMES.SCHEDULE_OPTIMIZATION },
      { name: QUEUE_NAMES.DOCUMENT_EXPIRY },
      { name: QUEUE_NAMES.BILLING_RETRY },
      { name: QUEUE_NAMES.AUDIT_RETENTION },
      { name: QUEUE_NAMES.OFFLINE_RECONCILIATION },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
