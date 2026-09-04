import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findUserNotifications(userId: string, isRead?: boolean) {
    const where: Record<string, any> = { recipientId: userId };
    if (typeof isRead === 'boolean') {
      where.isRead = isRead;
    }

    return this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async countUnread(userId: string) {
    return this.prisma.notification.count({
      where: { recipientId: userId, isRead: false },
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, recipientId: userId },
    });

    if (!notification) {
      throw new NotFoundException(`Notification with ID ${notificationId} not found`);
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { recipientId: userId, isRead: false },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  /**
   * Create an in-app notification row for a user. Used for in-app reminders and
   * event acknowledgements; this is never a push notification.
   */
  async createForUser(input: {
    companyId: string;
    recipientUserId: string;
    eventType: string;
    title: string;
    body: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  }) {
    return this.prisma.notification.create({
      data: {
        companyId: input.companyId,
        recipientId: input.recipientUserId,
        channel: 'in_app',
        eventType: input.eventType,
        title: input.title,
        body: input.body,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        deliveryStatus: 'delivered',
        deliveredAt: new Date(),
      },
    });
  }
}
