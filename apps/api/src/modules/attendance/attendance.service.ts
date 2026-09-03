import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ClockEventDto, AttendanceCorrectionDto } from '@sms/shared';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ScopeFilterService } from '../authorization/scope-filter.service';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeFilter: ScopeFilterService,
  ) {}

  async recordClockEvent(companyId: string, employeeId: string, dto: ClockEventDto) {
    // 1. Idempotency check scoped to the tenant: an idempotency key from another
    //    company must never deduplicate (or be treated as) this company's event.
    const existingEvent = await this.prisma.attendanceEvent.findFirst({
      where: { idempotencyKey: dto.idempotencyKey, companyId },
    });
    if (existingEvent) {
      return { status: 'deduplicated', eventId: existingEvent.id };
    }

    const occurredAt = new Date(dto.clientOccurredAt);
    const workDate = new Date(occurredAt.toISOString().slice(0, 10));

    return this.prisma.$transaction(async (tx) => {
      // 2. Find or create daily AttendanceRecord
      let record = await tx.attendanceRecord.findUnique({
        where: {
          employeeId_workDate: {
            employeeId,
            workDate,
          },
        },
      });

      if (!record) {
        record = await tx.attendanceRecord.create({
          data: {
            companyId,
            employeeId,
            workDate,
            status: 'present',
          },
        });
      }

      // 3. Create immutable AttendanceEvent
      const event = await tx.attendanceEvent.create({
        data: {
          attendanceRecordId: record.id,
          companyId,
          employeeId,
          eventType: dto.eventType,
          clientOccurredAt: occurredAt,
          source: dto.source,
          deviceIdentifier: dto.deviceIdentifier,
          idempotencyKey: dto.idempotencyKey,
          latitude: dto.latitude,
          longitude: dto.longitude,
          metadata: (dto.metadata as any) || {},
        },
      });

      // 4. Normalize daily AttendanceRecord state from event
      if (dto.eventType === 'clock_in') {
        if (!record.effectiveClockIn || occurredAt < record.effectiveClockIn) {
          await tx.attendanceRecord.update({
            where: { id: record.id },
            data: { effectiveClockIn: occurredAt },
          });
        }
      } else if (dto.eventType === 'clock_out') {
        if (!record.effectiveClockOut || occurredAt > record.effectiveClockOut) {
          const effectiveIn = record.effectiveClockIn || occurredAt;
          const totalWorkedMinutes = Math.max(
            0,
            Math.round((occurredAt.getTime() - effectiveIn.getTime()) / (1000 * 60)),
          );

          await tx.attendanceRecord.update({
            where: { id: record.id },
            data: {
              effectiveClockOut: occurredAt,
              totalWorkedMinutes,
            },
          });
        }
      } else if (dto.eventType === 'break_start') {
        await tx.break.create({
          data: {
            attendanceRecordId: record.id,
            employeeId,
            startAt: occurredAt,
            source: dto.source,
          },
        });
      } else if (dto.eventType === 'break_end') {
        const openBreak = await tx.break.findFirst({
          where: { attendanceRecordId: record.id, endAt: null },
          orderBy: { startAt: 'desc' },
        });

        if (openBreak) {
          const durationMinutes = Math.max(
            0,
            Math.round((occurredAt.getTime() - openBreak.startAt.getTime()) / (1000 * 60)),
          );

          await tx.break.update({
            where: { id: openBreak.id },
            data: {
              endAt: occurredAt,
              durationMinutes,
            },
          });

          // Accumulate break minutes on daily record
          const allBreaks = await tx.break.findMany({
            where: { attendanceRecordId: record.id, endAt: { not: null } },
          });
          const totalBreakMinutes = allBreaks.reduce(
            (sum, b) => sum + (b.durationMinutes || 0),
            0,
          );

          await tx.attendanceRecord.update({
            where: { id: record.id },
            data: { totalBreakMinutes },
          });
        }
      }

      return { status: 'recorded', eventId: event.id, recordId: record.id };
    });
  }

  async recordCorrection(
    companyId: string,
    dto: AttendanceCorrectionDto,
    userId: string,
  ) {
    const record = await this.prisma.attendanceRecord.findFirst({
      where: { id: dto.attendanceRecordId, companyId },
    });

    if (!record) {
      throw new NotFoundException(`Attendance record ${dto.attendanceRecordId} not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      const correction = await tx.attendanceCorrection.create({
        data: {
          attendanceRecordId: dto.attendanceRecordId,
          correctedById: userId,
          field: dto.field,
          previousValue: dto.previousValue,
          newValue: dto.newValue,
          reason: dto.reason,
        },
      });

      // Update record if applicable (e.g. status or notes)
      if (dto.field === 'status' && dto.newValue) {
        await tx.attendanceRecord.update({
          where: { id: dto.attendanceRecordId },
          data: { status: dto.newValue as any },
        });
      }

      return correction;
    });
  }

  async findDailyRecords(
    companyId: string,
    date: string,
    branchId?: string,
    membershipId?: string,
  ) {
    const workDate = new Date(date);

    // ADR-003 query scope: the caller's granted scope (via the `employee`
    // relation) AND-composes with any branchId filter; both narrow, neither
    // can widen the tenant-isolated records.
    const scopeWhere = membershipId
      ? await this.scopeFilter.employeeRelationWhere(membershipId, companyId)
      : undefined;

    const employeeFilter: Record<string, any> = {};
    if (branchId) employeeFilter.branchId = branchId;
    if (scopeWhere) Object.assign(employeeFilter, scopeWhere.employee);

    return this.prisma.attendanceRecord.findMany({
      where: {
        companyId,
        workDate,
        employee: employeeFilter,
      },
      include: {
        employee: {
          include: {
            branch: true,
            department: true,
            primaryPosition: true,
          },
        },
        events: { orderBy: { clientOccurredAt: 'asc' } },
        breaks: true,
        corrections: {
          include: {
            correctedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }

  async findEmployeeRecords(
    companyId: string,
    employeeId: string,
    startDate?: string,
    endDate?: string,
    membershipId?: string,
  ) {
    const where: Record<string, any> = { companyId, employeeId };

    if (membershipId) {
      const scopeWhere = await this.scopeFilter.employeeRelationWhere(
        membershipId,
        companyId,
      );
      if (scopeWhere) {
        // Requested employeeId ANDs with the caller's scope via the relation:
        // a branch/self-scoped caller requesting another employee's records
        // gets an empty result, never a widened one.
        where.employee = scopeWhere.employee;
      }
    }

    if (startDate || endDate) {
      where.workDate = {};
      if (startDate) where.workDate.gte = new Date(startDate);
      if (endDate) where.workDate.lte = new Date(endDate);
    }

    return this.prisma.attendanceRecord.findMany({
      where,
      orderBy: { workDate: 'desc' },
      include: {
        events: { orderBy: { clientOccurredAt: 'asc' } },
        breaks: true,
        corrections: true,
      },
    });
  }
}
