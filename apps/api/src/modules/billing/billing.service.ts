import {
  Injectable,
} from '@nestjs/common';

import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async getSubscription(companyId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { companyId },
      include: {
        plan: true,
        invoices: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    const activeEmployeeCount = await this.prisma.employee.count({
      where: { companyId, status: 'active' },
    });

    return {
      subscription,
      activeEmployeeCount,
      seatLimit: subscription?.plan?.maxEmployees ?? 0,
      utilizationPercentage:
        subscription?.plan?.maxEmployees && subscription.plan.maxEmployees > 0
          ? Math.round((activeEmployeeCount / subscription.plan.maxEmployees) * 100)
          : 0,
    };
  }

  async getPlans() {
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { priceMonthly: 'asc' },
    });
  }

  async handleWebhook(provider: string, eventId: string, eventType: string, payload: any) {
    // Check idempotency (ADR-008)
    const existing = await this.prisma.providerWebhookEvent.findUnique({
      where: { provider_eventId: { provider, eventId } },
    });

    if (existing) {
      return { status: 'ignored_duplicate', eventId };
    }

    return this.prisma.providerWebhookEvent.create({
      data: {
        provider,
        eventId,
        eventType,
        payload,
        processedAt: new Date(),
        status: 'processed',
      },
    });
  }
}
