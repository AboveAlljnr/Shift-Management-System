import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ClockEventDto,
  AttendanceCorrectionDto,
  GeofenceEnforcementConfigDto,
  PresenceVerificationConfig,
  PresenceVerifyDto,
  UpdatePresenceVerificationConfigDto,
} from '@sms/shared';

type GeofenceEnforcementConfig = {
  mode: 'strict' | 'warning' | 'off';
  allowMissingLocation: boolean;
};

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeFilterService } from '../authorization/scope-filter.service';
import { GeofenceService } from '../geofencing/geofence.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeFilter: ScopeFilterService,
    private readonly geofence: GeofenceService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
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

    // Presence verification (ADR-009): independent of geofence enforcement. When
    // enabled, each successful clock-in schedules exactly one PENDING verification
    // due verifyAfterMinutes after the clock-in, regardless of the geofence mode.
    const presenceConfig = await this.getPresenceVerificationConfig(companyId);

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
        // 4a. Presence verification (ADR-009): exactly one PENDING record per
        //     clock-in, due verifyAfterMinutes after the event. Applies whether
        //     geofence enforcement is strict, warning, or off.
        if (presenceConfig.enabled) {
          const linkedEmployee = await tx.employee.findUnique({
            where: { id: employeeId },
            select: { branchId: true, userId: true },
          });
          await tx.presenceVerification.create({
            data: {
              companyId,
              employeeId,
              branchId: linkedEmployee?.branchId ?? null,
              attendanceRecordId: record.id,
              attendanceEventId: event.id,
              dueAt: new Date(occurredAt.getTime() + presenceConfig.verifyAfterMinutes * 60_000),
              status: 'PENDING',
            },
          });
        }

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

  // ============================================================================
  // Presence verification (ADR-009): a post clock-in location check. The client
  // submits raw coordinates; every derivation (which employee/branch/fence, the
  // inside/outside result, distances) is computed server-side and never trusted
  // from the client.
  // ============================================================================

  /**
   * Effective presence verification configuration. Disabled unless a tenant
   * explicitly opts in. Defaults keep the hackathon-friendly 1-minute minimum
   * possible (verifyAfterMinutes >= 1) while production remains opt-in.
   */
  async getPresenceVerificationConfig(companyId: string): Promise<PresenceVerificationConfig> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    const settings = (company?.settings ?? {}) as Record<string, any>;
    const pv = (settings.presenceVerification ?? {}) as Partial<PresenceVerificationConfig>;
    return {
      enabled: pv.enabled ?? false,
      verifyAfterMinutes: pv.verifyAfterMinutes ?? 240,
      graceMinutes: pv.graceMinutes ?? 15,
    };
  }

  /** Persist only the settings.presenceVerification namespace (merge-safe). */
  async updatePresenceVerificationConfig(
    companyId: string,
    dto: Partial<UpdatePresenceVerificationConfigDto>,
  ): Promise<PresenceVerificationConfig> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    const settings = (company?.settings ?? {}) as Record<string, any>;
    const current = (settings.presenceVerification ?? {}) as Record<string, any>;

    settings.presenceVerification = {
      enabled: dto.enabled ?? current.enabled ?? false,
      verifyAfterMinutes: dto.verifyAfterMinutes ?? current.verifyAfterMinutes ?? 240,
      graceMinutes: dto.graceMinutes ?? current.graceMinutes ?? 15,
    };

    await this.prisma.company.update({
      where: { id: companyId },
      data: { settings },
    });

    await this.audit.record({
      companyId,
      action: 'attendance.presence_config.updated',
      resource: 'attendance',
      resourceId: companyId,
      before: { presenceVerification: current },
      after: { presenceVerification: settings.presenceVerification },
    });

    return this.getPresenceVerificationConfig(companyId);
  }

  /**
   * Lazy, server-authoritative MISSED reconciliation: any PENDING verification
   * past (dueAt + graceMinutes) is marked MISSED and audited. Runs on the
   * relevant reads so the UI always sees the current authoritative state.
   */
  private async reconcileExpiredPresenceVerifications(
    companyId: string,
    config?: PresenceVerificationConfig,
    now = new Date(),
  ): Promise<void> {
    const cfg = config ?? (await this.getPresenceVerificationConfig(companyId));
    if (!cfg.enabled) return;

    const cutoff = new Date(now.getTime() - cfg.graceMinutes * 60_000);
    const expired = await this.prisma.presenceVerification.findMany({
      where: { companyId, status: 'PENDING', dueAt: { lt: cutoff } },
      select: {
        id: true,
        branchId: true,
        employee: { select: { userId: true, firstName: true, lastName: true } },
      },
    });

    for (const pv of expired) {
      await this.prisma.presenceVerification.update({
        where: { id: pv.id },
        data: { status: 'MISSED', verifiedAt: now },
      });
      await this.audit.record({
        companyId,
        action: 'attendance.presence_verification.missed',
        resource: 'attendance.presence_verification',
        resourceId: pv.id,
        after: { branchId: pv.branchId, status: 'MISSED' },
      });
      if (pv.employee?.userId) {
        await this.notifications.createForUser({
          companyId,
          recipientUserId: pv.employee.userId,
          eventType: 'presence_verification.missed',
          title: 'Presence verification missed',
          body: `Your presence check was marked missed because it was not completed in time. Please speak with your manager.`,
          relatedEntityType: 'presence_verification',
          relatedEntityId: pv.id,
        });
      }
    }
  }

  /**
   * Self-scoped current presence verification for the caller's linked employee
   * profile. Returns the most recent verification plus whether the feature
   * applies, so the mobile client can render scheduled/due/resolved states.
   */
  async getMyPresenceVerification(companyId: string, userId: string) {
    const config = await this.getPresenceVerificationConfig(companyId);
    const employee = await this.prisma.employee.findFirst({
      where: { userId, companyId },
      select: { id: true },
    });
    if (!employee) {
      return { applicable: false, config, verification: null };
    }

    await this.reconcileExpiredPresenceVerifications(companyId, config);

    const verification = await this.prisma.presenceVerification.findFirst({
      where: { companyId, employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      include: {
        branch: { select: { id: true, name: true } },
      },
    });

    return {
      applicable: config.enabled,
      config,
      verification: verification
        ? {
            id: verification.id,
            status: verification.status,
            dueAt: verification.dueAt,
            verifiedAt: verification.verifiedAt,
            branchId: verification.branchId,
            branchName: verification.branch?.name ?? null,
            distanceMeters: verification.distanceMeters,
            geofenceRadiusMeters: verification.geofenceRadiusMeters,
            longitude: verification.longitude,
            latitude: verification.latitude,
          }
        : null,
    };
  }

  /**
   * Manager list of presence verifications, scoped by the caller's scope and the
   * company tenant. Out-of-fence and missed exceptions are surfaced first.
   */
  async listPresenceVerifications(
    companyId: string,
    membershipId?: string,
    statuses?: string[],
    now = new Date(),
  ) {
    await this.reconcileExpiredPresenceVerifications(companyId, undefined, now);

    const scopeWhere = membershipId
      ? await this.scopeFilter.employeeRelationWhere(membershipId, companyId)
      : undefined;

    const where: Record<string, any> = { companyId };
    if (statuses && statuses.length > 0) {
      where.status = { in: statuses };
    }
    if (scopeWhere) {
      where.employee = scopeWhere.employee;
    }

    const rows = await this.prisma.presenceVerification.findMany({
      where,
      orderBy: { dueAt: 'desc' },
      take: 200,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    const priority: Record<string, number> = {
      MISSED: 0,
      OUTSIDE_GEOFENCE: 1,
      PENDING: 2,
      VERIFIED: 3,
    };
    rows.sort(
      (a, b) =>
        (priority[a.status] ?? 9) - (priority[b.status] ?? 9) ||
        b.dueAt.getTime() - a.dueAt.getTime(),
    );

    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
      employeeNumber: r.employee.employeeNumber,
      branchId: r.branchId,
      branchName: r.branch?.name ?? null,
      dueAt: r.dueAt,
      verifiedAt: r.verifiedAt,
      status: r.status,
      distanceMeters: r.distanceMeters,
      geofenceRadiusMeters: r.geofenceRadiusMeters,
    }));
  }

  /**
   * Employee action: prove presence at the scheduled time by supplying ONLY
   * coordinates. The server derives ownership, tenant, branch, the active fence
   * and the inside/outside verdict. Geofence enforcement mode never changes the
   * result; this is a factual comparison against the branch's active fence.
   */
  async verifyPresence(
    companyId: string,
    verificationId: string,
    dto: PresenceVerifyDto,
    userId: string,
    now = new Date(),
  ) {
    const config = await this.getPresenceVerificationConfig(companyId);
    if (!config.enabled) {
      throw new BadRequestException({
        message: 'Presence verification is not enabled for this company.',
        errors: [{ code: 'PRESENCE_VERIFICATION_DISABLED' }],
      });
    }

    const verification = await this.prisma.presenceVerification.findUnique({
      where: { id: verificationId },
      include: {
        employee: { select: { userId: true, firstName: true, lastName: true, branchId: true } },
      },
    });

    if (!verification || verification.companyId !== companyId) {
      throw new NotFoundException('Presence verification not found');
    }
    if (verification.employee.userId !== userId) {
      throw new ForbiddenException('You are not authorized to verify this presence check');
    }

    // Lapsed and still unanswered -> MISSED (server-authoritative).
    const cutoff = new Date(now.getTime() - config.graceMinutes * 60_000);
    if (verification.status === 'PENDING' && verification.dueAt < cutoff) {
      await this.prisma.presenceVerification.update({
        where: { id: verification.id },
        data: { status: 'MISSED', verifiedAt: now },
      });
      await this.audit.record({
        companyId,
        action: 'attendance.presence_verification.missed',
        resource: 'attendance.presence_verification',
        resourceId: verification.id,
        after: { branchId: verification.branchId, status: 'MISSED' },
      });
      throw new ConflictException('The presence verification period has lapsed');
    }

    // Idempotent re-submission of an already resolved verification.
    if (verification.status !== 'PENDING') {
      return this.serializeVerified(verification);
    }

    if (!Number.isFinite(dto.latitude) || !Number.isFinite(dto.longitude)) {
      throw new BadRequestException({
        message: 'Valid coordinates are required to verify presence.',
        errors: [{ code: 'INVALID_COORDINATES' }],
      });
    }

    const branchId = verification.branchId ?? verification.employee.branchId;
    if (!branchId) {
      throw new BadRequestException({
        message: 'No branch is assigned to verify presence against.',
        errors: [{ code: 'GEOFENCE_UNAVAILABLE', message: 'No branch geofence is configured.' }],
      });
    }

    const fence = await this.prisma.geofence.findFirst({
      where: { companyId, branchId, isActive: true },
      select: { latitude: true, longitude: true, radiusMeters: true },
    });
    if (!fence) {
      throw new BadRequestException({
        message: 'No active geofence is configured for your branch.',
        errors: [{ code: 'GEOFENCE_UNAVAILABLE', message: 'No active geofence is configured.' }],
      });
    }

    const evaluation = this.geofence.evaluate(
      { latitude: dto.latitude, longitude: dto.longitude },
      { latitude: fence.latitude, longitude: fence.longitude, radiusMeters: fence.radiusMeters },
    );
    const inside = evaluation.inside;
    const status: 'VERIFIED' | 'OUTSIDE_GEOFENCE' = inside ? 'VERIFIED' : 'OUTSIDE_GEOFENCE';

    const updated = await this.prisma.presenceVerification.update({
      where: { id: verification.id },
      data: {
        status,
        verifiedAt: now,
        latitude: dto.latitude,
        longitude: dto.longitude,
        distanceMeters: evaluation.distanceMeters,
        geofenceRadiusMeters: evaluation.radiusMeters,
      },
    });

    // Audit result without raw coordinates; distance/radius are enough for review.
    await this.audit.record({
      companyId,
      action: `attendance.presence_verification.${status === 'VERIFIED' ? 'verified' : 'outside_geofence'}`,
      resource: 'attendance.presence_verification',
      resourceId: verification.id,
      after: {
        branchId,
        status,
        distanceMeters: evaluation.distanceMeters,
        geofenceRadiusMeters: evaluation.radiusMeters,
      },
    });

    if (verification.employee.userId) {
      await this.notifications.createForUser({
        companyId,
        recipientUserId: verification.employee.userId,
        eventType: `presence_verification.${status === 'VERIFIED' ? 'verified' : 'outside_geofence'}`,
        title: inside ? 'Presence verified' : 'Presence check flagged',
        body: inside
          ? 'Your presence was verified within the branch area.'
          : 'Your presence check was flagged because you were outside the branch area.',
        relatedEntityType: 'presence_verification',
        relatedEntityId: verification.id,
      });
    }

    return { ...this.serializeVerified({ ...updated, verificationType: 'updated' as const }), inside };
  }

  private serializeVerified(verification: any) {
    return {
      id: verification.id,
      status: verification.status,
      dueAt: verification.dueAt,
      verifiedAt: verification.verifiedAt,
      branchId: verification.branchId,
      distanceMeters: verification.distanceMeters,
      geofenceRadiusMeters: verification.geofenceRadiusMeters,
    };
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
