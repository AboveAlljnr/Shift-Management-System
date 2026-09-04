import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import type { CreateLeaveRequestDto, ReviewLeaveDto } from '@sms/shared';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ScopeFilterService } from '../authorization/scope-filter.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeFilter: ScopeFilterService,
    private readonly notifications: NotificationsService,
  ) {}

  async getLeaveTypes(companyId: string) {
    return this.prisma.leaveType.findMany({
      where: { companyId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async getLeaveRequests(
    companyId: string,
    filters: { employeeId?: string; status?: string; startDate?: string },
    membershipId?: string,
  ) {
    const where: Record<string, any> = { companyId };

    if (membershipId) {
      const scopeWhere = await this.scopeFilter.employeeRelationWhere(
        membershipId,
        companyId,
      );
      if (scopeWhere) {
        // Caller's granted scope ANDs with any employeeId/status/date filters
        // below, so they can only ever narrow the returned requests.
        where.employee = scopeWhere.employee;
      }
    }

    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.status) where.status = filters.status;
    if (filters.startDate) where.startDate = { gte: new Date(filters.startDate) };

    return this.prisma.leaveRequest.findMany({
      where,
      orderBy: { startDate: 'desc' },
      include: {
        leaveType: true,
        employee: true,
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async createLeaveRequest(
    companyId: string,
    employeeId: string,
    dto: CreateLeaveRequestDto,
  ) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (startDate > endDate) {
      throw new BadRequestException('Start date must be before or equal to end date');
    }

    return this.prisma.leaveRequest.create({
      data: {
        companyId,
        employeeId,
        leaveTypeId: dto.leaveTypeId,
        startDate,
        endDate,
        requestedDays: dto.requestedDays,
        reason: dto.reason,
        status: 'pending',
      },
      include: {
        leaveType: true,
        employee: true,
      },
    });
  }

  async reviewLeaveRequest(
    companyId: string,
    requestId: string,
    dto: ReviewLeaveDto,
    userId: string,
  ) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, companyId },
      include: {
        employee: { select: { id: true, userId: true, firstName: true, lastName: true } },
        leaveType: { select: { name: true } },
      },
    });

    if (!request) {
      throw new NotFoundException(`Leave request ${requestId} not found`);
    }

    if (request.status !== 'pending') {
      throw new BadRequestException(`Leave request is already ${request.status}`);
    }

    const newStatus = dto.action === 'approve' ? 'approved' : 'rejected';

    const updated = await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: {
        status: newStatus,
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNote: dto.note,
      },
      include: {
        leaveType: true,
        employee: true,
      },
    });

    if (request.employee.userId) {
      const approved = newStatus === 'approved';
      try {
        await this.notifications.createForUser({
          companyId,
          recipientUserId: request.employee.userId,
          eventType: approved ? 'leave.approved' : 'leave.rejected',
          title: approved ? 'Leave request approved' : 'Leave request declined',
          body: `Your ${request.leaveType.name} leave request was ${approved ? 'approved' : 'declined'}`,
          relatedEntityType: 'leave_request',
          relatedEntityId: requestId,
        });
      } catch (err) {
        this.logger.warn(`Failed to raise leave notification: ${(err as Error).message}`);
      }
    }

    return updated;
  }

  async getBalances(
    companyId: string,
    employeeId: string,
    year: number = new Date().getFullYear(),
    membershipId?: string,
  ) {
    const where: Record<string, any> = { companyId, employeeId, year };

    if (membershipId) {
      const scopeWhere = await this.scopeFilter.employeeRelationWhere(
        membershipId,
        companyId,
      );
      if (scopeWhere) {
        where.employee = scopeWhere.employee;
      }
    }

    return this.prisma.leaveBalance.findMany({
      where,
      include: { leaveType: true },
    });
  }
}
