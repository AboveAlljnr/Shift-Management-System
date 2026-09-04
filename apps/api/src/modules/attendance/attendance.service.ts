import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ClockEventDto,
  AttendanceCorrectionDto,
  GeofenceEnforcementConfigDto,
} from '@sms/shared';

type GeofenceEnforcementConfig = {
  mode: 'strict' | 'warning' | 'off';
  allowMissingLocation: boolean;
};

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeFilterService } from '../authorization/scope-filter.service';
import { GeofenceService } from '../geofencing/geofence.service';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeFilter: ScopeFilterService,
    private readonly geofence: GeofenceService,
    private readonly audit: AuditService,
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

    // Geofence enforcement (configurable, ADR-003). Only clock-in is
    // location-dependent: clock-out, break events are not. The employee must be
    // assigned to a branch with an ACTIVE geofence for a fence to apply, and the
    // company's configured enforcement mode decides whether an out-of-fence
    // clock-in is rejected, warned about, or not enforced at all.
    let geofenceResult: string | undefined;
    let geofenceWarning: string | undefined;
    let verified = false;
    if (dto.eventType === 'clock_in') {
      const enforcement = await this.getGeofenceEnforcementConfig(companyId);

      // "off" disables geofence enforcement entirely: no fence lookup, no
      // coordinate requirement, no verification at clock-in.
      if (enforcement.mode !== 'off') {
        const employee = await this.prisma.employee.findUnique({
          where: { id: employeeId },
          select: { branchId: true },
        });
        const branchId = employee?.branchId ?? null;
        const fence = branchId
          ? await this.prisma.geofence.findFirst({
              where: { companyId, branchId, isActive: true },
              include: { branch: { select: { name: true } } },
            })
          : null;

        if (fence) {
          this.assertClockInLocation(dto, fence.latitude, fence.longitude);

          const evaluation = this.geofence.evaluate(
            { latitude: dto.latitude as number, longitude: dto.longitude as number },
            {
              latitude: fence.latitude,
              longitude: fence.longitude,
              radiusMeters: fence.radiusMeters,
            },
          );

          if (!evaluation.inside) {
            if (enforcement.mode === 'strict') {
              // Do NOT create any attendance record/event for a denied clock-in.
              await this.audit.record({
                companyId,
                action: 'attendance.clock_in.geofence_denied',
                resource: 'attendance',
                resourceId: employeeId,
                after: {
                  branchId,
                  distanceMeters: evaluation.distanceMeters,
                  radiusMeters: evaluation.radiusMeters,
                },
              });
              throw new BadRequestException({
                message:
                  `You are outside the allowed clock-in area for ${fence.branch?.name ?? 'your branch'}. ` +
                  `You are ${Math.round(evaluation.distanceMeters)}m from the center (allowed within ${Math.round(evaluation.radiusMeters)}m).`,
                errors: [
                  {
                    code: 'GEOFENCE_OUTSIDE',
                    message: 'Outside allowed clock-in area',
                    details: {
                      branchId,
                      branchName: fence.branch?.name,
                      distanceMeters: evaluation.distanceMeters,
                      radiusMeters: evaluation.radiusMeters,
                    },
                  },
                ],
              });
            }

            // "warning" mode: accept the clock-in but flag it for review.
            if (enforcement.mode === 'warning') {
              geofenceResult = JSON.stringify({
                inside: false,
                distanceMeters: evaluation.distanceMeters,
                radiusMeters: evaluation.radiusMeters,
                mode: 'warning',
              });
              verified = false;
              geofenceWarning = 'GEOFENCE_OUTSIDE';
              await this.audit.record({
                companyId,
                action: 'attendance.clock_in.geofence_warning',
                resource: 'attendance',
                resourceId: employeeId,
                after: {
                  branchId,
                  mode: 'warning',
                  distanceMeters: evaluation.distanceMeters,
                  radiusMeters: evaluation.radiusMeters,
                },
              });
            }
          } else {
            geofenceResult = JSON.stringify({
              inside: true,
              distanceMeters: evaluation.distanceMeters,
              radiusMeters: evaluation.radiusMeters,
            });
            verified = true;
          }
        }
      }
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
          geofenceResult,
          metadata: {
            ...((dto.metadata as Record<string, unknown>) || {}),
            ...(dto.eventType === 'clock_in'
              ? { verified, ...(geofenceWarning ? { geofenceWarning } : {}) }
              : {}),
          },
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

  /**
   * Self-scoped status endpoint: whether the caller's linked employee profile
   * is assigned to a branch with an ACTIVE geofence. Lets the web client decide
   * whether to request geolocation on clock-in without exposing other tenants'
   * data or any fence coordinates beyond what the caller already knows.
   */
  async getMyGeofenceStatus(companyId: string, userId: string) {
    const enforcement = await this.getGeofenceEnforcementConfig(companyId);

    // When geofence enforcement is disabled company-wide, no fence is applied
    // and the client does not need to request geolocation.
    if (enforcement.mode === 'off') {
      return { applicable: false, mode: 'off' as const };
    }

    const employee = await this.prisma.employee.findFirst({
      where: { userId, companyId },
      select: {
        id: true,
        branch: { select: { id: true, name: true } },
      },
    });

    if (!employee?.branch?.id) {
      return { applicable: false };
    }

    const fence = await this.prisma.geofence.findFirst({
      where: { companyId, branchId: employee.branch.id, isActive: true },
      select: { radiusMeters: true },
    });

    if (!fence) {
      return {
        applicable: false,
        mode: enforcement.mode,
        branchId: employee.branch.id,
        branchName: employee.branch.name,
      };
    }

    return {
      applicable: true,
      mode: enforcement.mode,
      branchId: employee.branch.id,
      branchName: employee.branch.name,
      radiusMeters: fence.radiusMeters,
    };
  }

  /**
   * Effective geofence enforcement configuration for a company. Any unset key
   * falls back to a safe default (strict = current behavior), so a tenant that
   * has never configured geofence enforcement keeps its existing clock-in rules.
   */
  async getGeofenceEnforcementConfig(companyId: string): Promise<GeofenceEnforcementConfig> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    const settings = (company?.settings ?? {}) as Record<string, any>;
    const enforcement = (settings.geofence ?? {}) as Partial<GeofenceEnforcementConfig>;
    return {
      mode: enforcement.mode ?? 'strict',
      allowMissingLocation: enforcement.allowMissingLocation ?? false,
    };
  }

  /** Persist a partial geofence enforcement configuration on the company. */
  async updateGeofenceEnforcementConfig(
    companyId: string,
    dto: Partial<GeofenceEnforcementConfigDto>,
  ) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    const settings = (company?.settings ?? {}) as Record<string, any>;
    const current = (settings.geofence ?? {}) as Record<string, any>;

    settings.geofence = {
      mode: dto.mode ?? current.mode ?? 'strict',
      allowMissingLocation: dto.allowMissingLocation ?? current.allowMissingLocation ?? false,
    };

    await this.prisma.company.update({
      where: { id: companyId },
      data: { settings },
    });

    return this.getGeofenceEnforcementConfig(companyId);
  }

  /**
   * A geofenced branch requires raw coordinates; without them we cannot make
   * an authoritative server-side decision, so we reject rather than accepting
   * an unchecked clock-in.
   */
  private assertClockInLocation(dto: ClockEventDto, fenceLat: number, fenceLng: number) {
    if (typeof dto.latitude !== 'number' || typeof dto.longitude !== 'number') {
      throw new BadRequestException({
        message: 'Location is required to clock in at this geofenced branch.',
        errors: [
          {
            code: 'GEOFENCE_LOCATION_REQUIRED',
            message: 'Your browser location could not be captured.',
            details: { fenceLatitude: fenceLat, fenceLongitude: fenceLng },
          },
        ],
      });
    }
  }
}
