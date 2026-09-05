import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AttendanceService } from './attendance.service';

function companyWideScopeFilter(): never {
  return {
    employeeWhere: async () => undefined,
    employeeRelationWhere: async () => undefined,
    shiftQueryScope: async () => ({ shiftWhere: undefined, assignmentEmployeeWhere: undefined }),
    branchWhere: async () => undefined,
    departmentWhere: async () => undefined,
    teamWhere: async () => undefined,
    positionWhere: async () => undefined,
  } as never;
}

const geofenceSvc = { evaluate: vi.fn() };
const auditSvc = { record: vi.fn() };
const notificationsSvc = { createForUser: vi.fn().mockResolvedValue({}) };

function createDeps() {
  const attendanceEvent = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  };
  const attendanceRecord = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const breakRecord = {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  };
  const attendanceCorrection = { create: vi.fn() };
  const employee = { findFirst: vi.fn(), findUnique: vi.fn() };
  const geofence = { findFirst: vi.fn() };
  const presenceVerification = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const company = {
    findUnique: vi.fn().mockResolvedValue({ settings: {} }),
    update: vi.fn().mockResolvedValue({}),
  };
  const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn({ attendanceEvent, attendanceRecord, break: breakRecord, attendanceCorrection, presenceVerification, employee } as any),
  );
  const prisma = {
    attendanceEvent,
    attendanceRecord,
    break: breakRecord,
    attendanceCorrection,
    employee,
    geofence,
    presenceVerification,
    company,
    $transaction,
  };
  return { prisma, attendanceEvent, attendanceRecord, breakRecord, attendanceCorrection, employee, geofence, presenceVerification, company };
}

function presenceEnabled(overrides: Partial<{ enabled: boolean; verifyAfterMinutes: number; graceMinutes: number }> = {}) {
  const deps = createDeps();
  deps.company.findUnique.mockResolvedValue({
    settings: { presenceVerification: { enabled: true, verifyAfterMinutes: 30, graceMinutes: 15, ...overrides } },
  });
  return deps;
}

const clockInDto = {
  eventType: 'clock_in' as const,
  clientOccurredAt: '2026-09-02T09:05:00.000Z',
  source: 'web' as const,
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
};

const clockOutDto = {
  eventType: 'clock_out' as const,
  clientOccurredAt: '2026-09-02T17:10:00.000Z',
  source: 'web' as const,
  idempotencyKey: '22222222-2222-4222-8222-222222222222',
};

describe('AttendanceService — idempotency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deduplicates an event with an existing idempotency key without writing anything', async () => {
    const { attendanceEvent, attendanceRecord, attendanceCorrection } = createDeps();
    attendanceEvent.findFirst.mockResolvedValue({ id: 'ev1' });

    const service = new AttendanceService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { attendanceEvent, attendanceRecord, attendanceCorrection, employee: { findUnique: vi.fn() }, geofence: { findFirst: vi.fn() }, $transaction: vi.fn() } as any,
      companyWideScopeFilter(),
      geofenceSvc,
      auditSvc,
      notificationsSvc,
    );
    const result = await service.recordClockEvent('c1', 'e1', clockInDto);

    expect(result).toEqual({ status: 'deduplicated', eventId: 'ev1' });
    expect(attendanceEvent.findFirst).toHaveBeenCalledWith({
      where: { idempotencyKey: clockInDto.idempotencyKey, companyId: 'c1' },
    });
    expect(attendanceRecord.findUnique).not.toHaveBeenCalled();
  });

  it('never deduplicates an event whose idempotency key exists under another company', async () => {
    const { prisma, attendanceRecord, attendanceEvent, employee } = createDeps();
    attendanceEvent.findFirst.mockResolvedValue(null);
    attendanceRecord.findUnique.mockResolvedValue(null);
    attendanceRecord.create.mockResolvedValue({ id: 'rec1' });
    employee.findUnique.mockResolvedValue({ branchId: null });
    attendanceEvent.create.mockResolvedValue({ id: 'evX' });
    attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.recordClockEvent('c1', 'e1', clockInDto);

    expect(result.status).toBe('recorded');
    expect(attendanceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ idempotencyKey: clockInDto.idempotencyKey, companyId: 'c1' }),
      }),
    );
  });

  it('creates a daily record on first clock_in and stores the earliest clock-in', async () => {
    const { prisma, attendanceRecord, attendanceEvent, employee } = createDeps();
    attendanceEvent.findFirst.mockResolvedValue(null);
    attendanceRecord.findUnique.mockResolvedValue(null);
    attendanceRecord.create.mockResolvedValue({ id: 'rec1' });
    employee.findUnique.mockResolvedValue({ branchId: null });
    attendanceEvent.create.mockResolvedValue({ id: 'ev2' });
    attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.recordClockEvent('c1', 'e1', clockInDto);

    expect(result.status).toBe('recorded');
    expect(attendanceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ companyId: 'c1', employeeId: 'e1', status: 'present' }),
      }),
    );
    expect(attendanceRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { effectiveClockIn: new Date(clockInDto.clientOccurredAt) } }),
    );
  });

  it('normalizes clock_out into worked minutes against the effective clock-in', async () => {
    const { prisma, attendanceRecord, attendanceEvent } = createDeps();
    attendanceEvent.findFirst.mockResolvedValue(null);
    attendanceRecord.findUnique.mockResolvedValue({
      id: 'rec1',
      effectiveClockIn: new Date('2026-09-02T09:00:00.000Z'),
      effectiveClockOut: null,
      totalWorkedMinutes: 0,
    });
    attendanceEvent.create.mockResolvedValue({ id: 'ev3' });
    attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.recordClockEvent('c1', 'e1', clockOutDto);

    expect(result.status).toBe('recorded');
    const updateCall = attendanceRecord.update.mock.calls[0][0];
    expect(updateCall.data.effectiveClockOut).toEqual(new Date(clockOutDto.clientOccurredAt));
    // 09:00 -> 17:10 = 490 minutes
    expect(updateCall.data.totalWorkedMinutes).toBe(490);
  });

  it('accumulates break minutes when a break ends', async () => {
    const { prisma, attendanceRecord, attendanceEvent, breakRecord } = createDeps();
    attendanceEvent.findFirst.mockResolvedValue(null);
    attendanceRecord.findUnique.mockResolvedValue({
      id: 'rec1',
      effectiveClockIn: new Date('2026-09-02T09:00:00.000Z'),
    });
    attendanceEvent.create.mockResolvedValue({ id: 'ev4' });
    breakRecord.findFirst.mockResolvedValue({ id: 'br1', startAt: new Date('2026-09-02T12:00:00.000Z') });
    breakRecord.update.mockResolvedValue({});
    breakRecord.findMany.mockResolvedValue([
      { durationMinutes: 30 },
      { durationMinutes: 15 },
    ]);
    attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.recordClockEvent('c1', 'e1', {
      eventType: 'break_end',
      clientOccurredAt: '2026-09-02T12:45:00.000Z',
      source: 'web',
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
    });

    expect(result.status).toBe('recorded');
    const updateCall = attendanceRecord.update.mock.calls.at(-1)?.[0];
    expect(updateCall.data.totalBreakMinutes).toBe(45);
  });
});

describe('AttendanceService — corrections', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects correction of a record outside the company tenant', async () => {
    const { prisma, attendanceRecord } = createDeps();
    attendanceRecord.findFirst.mockResolvedValue(null);

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(
      service.recordCorrection('c1', { attendanceRecordId: 'rec9', field: 'status', newValue: 'present', reason: 'fix' }, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records the correction with a mandatory reason and updates the status field', async () => {
    const { prisma, attendanceRecord, attendanceCorrection } = createDeps();
    attendanceRecord.findFirst.mockResolvedValue({ id: 'rec1', companyId: 'c1' });
    attendanceCorrection.create.mockResolvedValue({ id: 'co1' });
    attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const dto = { attendanceRecordId: 'rec1', field: 'status', previousValue: 'absent', newValue: 'present', reason: 'Swipe card was faulty' };
    const result = await service.recordCorrection('c1', dto, 'u1');

    expect(result).toEqual({ id: 'co1' });
    expect(attendanceCorrection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ correctedById: 'u1', reason: 'Swipe card was faulty' }),
      }),
    );
    expect(attendanceRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'present' } }),
    );
  });
});

describe('AttendanceService — geofenced clock-in', () => {
  beforeEach(() => vi.clearAllMocks());

  const fence = {
    latitude: 40.7128,
    longitude: -74.006,
    radiusMeters: 100,
    branch: { name: 'Downtown' },
  };

  function geoDto(latitude?: number, longitude?: number) {
    return {
      eventType: 'clock_in' as const,
      clientOccurredAt: '2026-09-02T09:05:00.000Z',
      source: 'web' as const,
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
      latitude,
      longitude,
    };
  }

  it('accepts a clock-in inside the active geofence and persists the evaluated result', async () => {
    const { prisma, attendanceEvent, attendanceRecord, employee, geofence } = createDeps();
    attendanceEvent.findFirst.mockResolvedValue(null);
    attendanceRecord.findUnique.mockResolvedValue(null);
    attendanceRecord.create.mockResolvedValue({ id: 'rec1' });
    employee.findUnique.mockResolvedValue({ branchId: 'b1' });
    geofence.findFirst.mockResolvedValue(fence as never);
    geofenceSvc.evaluate.mockReturnValue({ distanceMeters: 50, radiusMeters: 100, inside: true });
    attendanceEvent.create.mockResolvedValue({ id: 'evG' });
    attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.recordClockEvent('c1', 'e1', geoDto(-74.0055, 40.7129));

    expect(result.status).toBe('recorded');
    expect(geofenceSvc.evaluate).toHaveBeenCalledWith(
      { latitude: -74.0055, longitude: 40.7129 },
      { latitude: 40.7128, longitude: -74.006, radiusMeters: 100 },
    );
    expect(attendanceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          latitude: -74.0055,
          longitude: 40.7129,
          geofenceResult: JSON.stringify({ inside: true, distanceMeters: 50, radiusMeters: 100 }),
        }),
      }),
    );
  });

  it('rejects a clock-in outside the geofence without creating a record/event and audits the denial', async () => {
    const { prisma, attendanceEvent, attendanceRecord, employee, geofence } = createDeps();
    attendanceEvent.findFirst.mockResolvedValue(null);
    employee.findUnique.mockResolvedValue({ branchId: 'b1' });
    geofence.findFirst.mockResolvedValue(fence as never);
    geofenceSvc.evaluate.mockReturnValue({ distanceMeters: 500, radiusMeters: 100, inside: false });

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(service.recordClockEvent('c1', 'e1', geoDto(-73.99, 40.75))).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(attendanceEvent.create).not.toHaveBeenCalled();
    expect(attendanceRecord.create).not.toHaveBeenCalled();
    expect(auditSvc.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'attendance.clock_in.geofence_denied', resourceId: 'e1' }),
    );
  });

  it('rejects a clock-in without coordinates when an active geofence applies', async () => {
    const { prisma, attendanceEvent, attendanceRecord, employee, geofence } = createDeps();
    attendanceEvent.findFirst.mockResolvedValue(null);
    employee.findUnique.mockResolvedValue({ branchId: 'b1' });
    geofence.findFirst.mockResolvedValue(fence as never);

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(service.recordClockEvent('c1', 'e1', geoDto())).rejects.toBeInstanceOf(BadRequestException);

    expect(attendanceEvent.create).not.toHaveBeenCalled();
    expect(attendanceRecord.create).not.toHaveBeenCalled();
  });

  it('does not trust client-supplied metadata: an outside result is rejected regardless of spoofed data', async () => {
    const { prisma, attendanceEvent, employee, geofence } = createDeps();
    attendanceEvent.findFirst.mockResolvedValue(null);
    employee.findUnique.mockResolvedValue({ branchId: 'b1' });
    geofence.findFirst.mockResolvedValue(fence as never);
    geofenceSvc.evaluate.mockReturnValue({ distanceMeters: 9999, radiusMeters: 100, inside: false });

    const spoofed = { ...geoDto(-73.99, 40.75), metadata: { inside: true, distanceMeters: 1 } };
    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(service.recordClockEvent('c1', 'e1', spoofed)).rejects.toBeInstanceOf(BadRequestException);
    expect(attendanceEvent.create).not.toHaveBeenCalled();
  });

  it('keeps clock-out geofence-independent when an active geofence exists', async () => {
    const { prisma, attendanceEvent, attendanceRecord, employee, geofence } = createDeps();
    attendanceEvent.findFirst.mockResolvedValue(null);
    attendanceRecord.findUnique.mockResolvedValue({
      id: 'rec1',
      effectiveClockIn: new Date('2026-09-02T09:00:00.000Z'),
      effectiveClockOut: null,
      totalWorkedMinutes: 0,
    });
    // Employee is assigned to a geofenced branch, but clock-out must NOT be enforced.
    employee.findUnique.mockResolvedValue({ branchId: 'b1' });
    geofence.findFirst.mockResolvedValue(fence as never);
    attendanceEvent.create.mockResolvedValue({ id: 'evC' });
    attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.recordClockEvent('c1', 'e1', {
      eventType: 'clock_out',
      clientOccurredAt: '2026-09-02T17:10:00.000Z',
      source: 'web',
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
    });

    expect(result.status).toBe('recorded');
    expect(geofenceSvc.evaluate).not.toHaveBeenCalled();
    expect(attendanceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'clock_out', geofenceResult: undefined }),
      }),
    );
  });

  it('preserves original behavior when the employee has no active geofence', async () => {
    const { prisma, attendanceEvent, attendanceRecord, employee, geofence } = createDeps();
    attendanceEvent.findFirst.mockResolvedValue(null);
    attendanceRecord.findUnique.mockResolvedValue(null);
    attendanceRecord.create.mockResolvedValue({ id: 'rec1' });
    employee.findUnique.mockResolvedValue({ branchId: null });
    attendanceEvent.create.mockResolvedValue({ id: 'evP' });
    attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.recordClockEvent('c1', 'e1', geoDto(-74.0, 40.71));

    expect(result.status).toBe('recorded');
    expect(geofence.findFirst).not.toHaveBeenCalled();
    expect(geofenceSvc.evaluate).not.toHaveBeenCalled();
    expect(attendanceEvent.create).toHaveBeenCalled();
  });
});

describe('AttendanceService — configurable geofence enforcement', () => {
  beforeEach(() => vi.clearAllMocks());

  const fence = {
    latitude: 40.7128,
    longitude: -74.006,
    radiusMeters: 100,
    branch: { name: 'Downtown' },
  };

  function clockIn(latitude?: number, longitude?: number) {
    return {
      eventType: 'clock_in' as const,
      clientOccurredAt: '2026-09-02T09:05:00.000Z',
      source: 'web' as const,
      idempotencyKey: '66666666-6666-4666-8666-666666666666',
      latitude,
      longitude,
    };
  }

  function depsWithEnforcement(enforcement: { mode?: 'strict' | 'warning' | 'off'; allowMissingLocation?: boolean } | undefined) {
    const deps = createDeps();
    deps.company.findUnique.mockResolvedValue({
      settings: enforcement ? { geofence: enforcement } : {},
    });
    return deps;
  }

  it('defaults to strict enforcement when the company has never configured geofence enforcement', async () => {
    const { prisma, attendanceEvent, attendanceRecord, employee, geofence } = depsWithEnforcement(undefined);
    attendanceEvent.findFirst.mockResolvedValue(null);
    attendanceRecord.findUnique.mockResolvedValue(null);
    employee.findUnique.mockResolvedValue({ branchId: 'b1' });
    geofence.findFirst.mockResolvedValue(fence as never);
    geofenceSvc.evaluate.mockReturnValue({ distanceMeters: 500, radiusMeters: 100, inside: false });

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(service.recordClockEvent('c1', 'e1', clockIn(-73.99, 40.75))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(attendanceEvent.create).not.toHaveBeenCalled();
  });

  it('warning mode accepts an out-of-fence clock-in and flags it as unverified', async () => {
    const { prisma, attendanceEvent, attendanceRecord, employee, geofence } = depsWithEnforcement({ mode: 'warning' });
    attendanceEvent.findFirst.mockResolvedValue(null);
    attendanceRecord.findUnique.mockResolvedValue(null);
    attendanceRecord.create.mockResolvedValue({ id: 'recW' });
    employee.findUnique.mockResolvedValue({ branchId: 'b1' });
    geofence.findFirst.mockResolvedValue(fence as never);
    geofenceSvc.evaluate.mockReturnValue({ distanceMeters: 500, radiusMeters: 100, inside: false });
    attendanceEvent.create.mockResolvedValue({ id: 'evW' });
    attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.recordClockEvent('c1', 'e1', clockIn(-73.99, 40.75));

    expect(result.status).toBe('recorded');
    expect(attendanceRecord.create).toHaveBeenCalled();
    expect(attendanceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          geofenceResult: JSON.stringify({ inside: false, distanceMeters: 500, radiusMeters: 100, mode: 'warning' }),
          metadata: expect.objectContaining({ verified: false, geofenceWarning: 'GEOFENCE_OUTSIDE' }),
        }),
      }),
    );
    expect(auditSvc.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'attendance.clock_in.geofence_warning' }),
    );
  });

  it('off mode skips geofence enforcement entirely even with an active fence and no coordinates', async () => {
    const { prisma, attendanceEvent, attendanceRecord, employee, geofence } = depsWithEnforcement({ mode: 'off' });
    attendanceEvent.findFirst.mockResolvedValue(null);
    attendanceRecord.findUnique.mockResolvedValue(null);
    attendanceRecord.create.mockResolvedValue({ id: 'recO' });
    // Employee is still assigned to a geofenced branch, but enforcement is off.
    employee.findUnique.mockResolvedValue({ branchId: 'b1' });
    attendanceEvent.create.mockResolvedValue({ id: 'evO' });
    attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.recordClockEvent('c1', 'e1', clockIn());

    expect(result.status).toBe('recorded');
    expect(geofence.findFirst).not.toHaveBeenCalled();
    expect(geofenceSvc.evaluate).not.toHaveBeenCalled();
    expect(attendanceEvent.create).toHaveBeenCalled();
  });

  it('off mode short-circuits the self-scoped geofence status', async () => {
    const deps = depsWithEnforcement({ mode: 'off' });
    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const status = await service.getMyGeofenceStatus('c1', 'u1');
    expect(status).toEqual({ applicable: false, mode: 'off' });
  });

  it('getGeofenceEnforcementConfig returns effective merged defaults for an unset company', async () => {
    const deps = depsWithEnforcement(undefined);
    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(service.getGeofenceEnforcementConfig('c1')).resolves.toEqual({
      mode: 'strict',
      allowMissingLocation: false,
    });
  });

  it('getGeofenceEnforcementConfig surfaces a persisted partial config', async () => {
    const deps = depsWithEnforcement({ mode: 'warning' });
    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(service.getGeofenceEnforcementConfig('c1')).resolves.toEqual({
      mode: 'warning',
      allowMissingLocation: false,
    });
  });

  it('updateGeofenceEnforcementConfig persists the mode into company settings and returns the effective config', async () => {
    const deps = depsWithEnforcement(undefined);
    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);

    const result = await service.updateGeofenceEnforcementConfig('c1', { mode: 'warning' });

    expect(result).toEqual({ mode: 'warning', allowMissingLocation: false });
    expect(deps.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ settings: { geofence: { mode: 'warning', allowMissingLocation: false } } }),
      }),
    );
  });

  it('geofence enforcement config is tenant-isolated: no settings on the company means strict defaults', async () => {
    const deps = depsWithEnforcement(undefined);
    // A missing company row also falls back to strict defaults (never reads another tenant).
    deps.company.findUnique.mockResolvedValue(null);
    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(service.getGeofenceEnforcementConfig('c1')).resolves.toEqual({
      mode: 'strict',
      allowMissingLocation: false,
    });
  });
});

describe('AttendanceService — presence verification config', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to disabled outside the office-hours re-verification window when unset', async () => {
    const deps = createDeps();
    deps.company.findUnique.mockResolvedValue({ settings: {} });
    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(service.getPresenceVerificationConfig('c1')).resolves.toEqual({
      enabled: false,
      verifyAfterMinutes: 240,
      graceMinutes: 15,
    });
  });

  it('surfaces a persisted partial presence config merged with defaults', async () => {
    const deps = createDeps();
    deps.company.findUnique.mockResolvedValue({
      settings: { presenceVerification: { enabled: true } },
    });
    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(service.getPresenceVerificationConfig('c1')).resolves.toEqual({
      enabled: true,
      verifyAfterMinutes: 240,
      graceMinutes: 15,
    });
  });

  it('persists only the presenceVerification namespace, preserving other settings, and allows a 1-minute window', async () => {
    const deps = createDeps();
    deps.company.findUnique
      .mockResolvedValueOnce({ settings: { attendance: { colorScheme: 'dark' } } })
      .mockResolvedValue({
        settings: { attendance: { colorScheme: 'dark' }, presenceVerification: { enabled: true, verifyAfterMinutes: 1, graceMinutes: 15 } },
      });
    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);

    const result = await service.updatePresenceVerificationConfig('c1', { enabled: true, verifyAfterMinutes: 1 });

    expect(result).toEqual({ enabled: true, verifyAfterMinutes: 1, graceMinutes: 15 });
    expect(deps.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          settings: expect.objectContaining({
            attendance: { colorScheme: 'dark' },
            presenceVerification: { enabled: true, verifyAfterMinutes: 1, graceMinutes: 15 },
          }),
        }),
      }),
    );
    expect(auditSvc.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'attendance.presence_config.updated' }),
    );
  });
});

describe('AttendanceService — presence verification on clock-in', () => {
  beforeEach(() => vi.clearAllMocks());

  function clockIn() {
    return {
      eventType: 'clock_in' as const,
      clientOccurredAt: '2026-09-02T09:05:00.000Z',
      source: 'web' as const,
      idempotencyKey: '88888888-8888-4888-8888-888888888888',
    };
  }

  it('does not schedule presence verification when the feature is disabled', async () => {
    const deps = createDeps(); // settings {} => presence disabled by default
    deps.attendanceEvent.findFirst.mockResolvedValue(null);
    deps.attendanceRecord.findUnique.mockResolvedValue(null);
    deps.attendanceRecord.create.mockResolvedValue({ id: 'rec1' });
    deps.employee.findUnique.mockResolvedValue({ branchId: null });
    deps.attendanceEvent.create.mockResolvedValue({ id: 'evN' });
    deps.attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.recordClockEvent('c1', 'e1', clockIn());

    expect(result.status).toBe('recorded');
    expect(deps.presenceVerification.create).not.toHaveBeenCalled();
  });

  it('schedules exactly one PENDING verification per clock-in, due verifyAfterMinutes after the event', async () => {
    const deps = presenceEnabled(); // enabled, verifyAfterMinutes 30
    deps.attendanceEvent.findFirst.mockResolvedValue(null);
    deps.attendanceRecord.findUnique.mockResolvedValue(null);
    deps.attendanceRecord.create.mockResolvedValue({ id: 'rec1' });
    deps.employee.findUnique.mockResolvedValue({ branchId: null });
    deps.attendanceEvent.create.mockResolvedValue({ id: 'evP' });
    deps.attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.recordClockEvent('c1', 'e1', clockIn());

    expect(result.status).toBe('recorded');
    expect(deps.presenceVerification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'c1',
          employeeId: 'e1',
          attendanceRecordId: 'rec1',
          attendanceEventId: 'evP',
          status: 'PENDING',
          dueAt: new Date('2026-09-02T09:35:00.000Z'), // clientOccurredAt 09:05 + 30 minutes
        }),
      }),
    );
  });
});

describe('AttendanceService — self-scoped presence verification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns no verification (and skips reconciliation) when the caller has no linked employee profile', async () => {
    const deps = presenceEnabled();
    deps.employee.findFirst.mockResolvedValue(null);

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.getMyPresenceVerification('c1', 'u1');

    expect(result.applicable).toBe(false);
    expect(result.verification).toBeNull();
    expect(deps.presenceVerification.findFirst).not.toHaveBeenCalled();
  });

  it('returns the scheduled verification with branch name and runs lazy MISSED reconciliation', async () => {
    const deps = presenceEnabled();
    deps.employee.findFirst.mockResolvedValue({ id: 'e1' });
    const pending = {
      id: 'pv1',
      status: 'PENDING',
      dueAt: new Date('2026-09-02T09:35:00.000Z'),
      verifiedAt: null,
      branchId: 'b1',
      distanceMeters: null,
      geofenceRadiusMeters: null,
      latitude: null,
      longitude: null,
      branch: { id: 'b1', name: 'Main Branch' },
    };
    deps.presenceVerification.findFirst.mockResolvedValue(pending as never);
    deps.presenceVerification.findMany.mockResolvedValue([]); // nothing expired

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.getMyPresenceVerification('c1', 'u1');

    expect(result.applicable).toBe(true);
    expect(result.verification?.status).toBe('PENDING');
    expect(result.verification?.branchName).toBe('Main Branch');
    expect(deps.presenceVerification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'c1', status: 'PENDING' }) }),
    );
  });
});

describe('AttendanceService — verify presence', () => {
  beforeEach(() => vi.clearAllMocks());

  const NOW = new Date('2026-09-02T10:00:00.000Z');

  const FENCE = { latitude: 40.7128, longitude: -74.006, radiusMeters: 100 };

  function depsWithEnabled() {
    const deps = presenceEnabled(); // 30-minute window, 15-minute grace
    deps.presenceVerification.findMany.mockResolvedValue([]); // lapsed check on reads
    return deps;
  }

  function pendingVerification(partial: Partial<{
    status: string;
    dueAt: Date;
    branchId: string | null;
    companyId: string;
    userId: string;
    employee: { userId: string; firstName: string; lastName: string; branchId: string | null };
  }> = {}) {
    return {
      id: 'pv1',
      companyId: 'c1',
      status: 'PENDING',
      dueAt: new Date('2026-09-02T10:02:00.000Z'),
      verifiedAt: null,
      branchId: 'b1',
      employee: { userId: 'u1', firstName: 'Jane', lastName: 'Doe', branchId: 'b1' as string | null },
      ...partial,
    };
  }

  it('rejects when the tenant does not own the verification', async () => {
    const deps = depsWithEnabled();
    deps.presenceVerification.findUnique.mockResolvedValue(
      pendingVerification({ companyId: 'other-tenant' }) as never,
    );

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(
      service.verifyPresence('c1', 'pv1', { latitude: 40.7, longitude: -74.0 }, 'u1', NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects ownership: only the linked employee may answer their own presence check', async () => {
    const deps = depsWithEnabled();
    deps.presenceVerification.findUnique.mockResolvedValue(
      pendingVerification({ employee: { userId: 'someone-else', firstName: 'Other', lastName: 'User', branchId: 'b1' } }) as never,
    );

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(
      service.verifyPresence('c1', 'pv1', { latitude: 40.7, longitude: -74.0 }, 'u1', NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a lapsed unanswered check as Conflict and marks it MISSED server-side', async () => {
    const deps = depsWithEnabled();
    deps.presenceVerification.findUnique.mockResolvedValue(
      pendingVerification({ dueAt: new Date('2026-09-02T09:00:00.000Z') }) as never, // well past grace
    );
    deps.presenceVerification.update.mockResolvedValue({} as never);

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(
      service.verifyPresence('c1', 'pv1', { latitude: 40.7, longitude: -74.0 }, 'u1', NOW),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(deps.presenceVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'MISSED' }) }),
    );
    expect(auditSvc.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'attendance.presence_verification.missed' }),
    );
  });

  it('rejects invalid coordinates with INVALID_COORDINATES', async () => {
    const deps = depsWithEnabled();
    deps.presenceVerification.findUnique.mockResolvedValue(pendingVerification() as never);

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(
      service.verifyPresence('c1', 'pv1', { latitude: NaN, longitude: 40 }, 'u1', NOW),
    ).rejects.toMatchObject({ response: { errors: [{ code: 'INVALID_COORDINATES' }] } });
  });

  it('rejects when no branch geofence is available', async () => {
    const deps = depsWithEnabled();
    deps.presenceVerification.findUnique.mockResolvedValue(
      pendingVerification({ branchId: null }) as never,
    );

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await expect(
      service.verifyPresence('c1', 'pv1', { latitude: 40.7, longitude: -74.0 }, 'u1', NOW),
    ).rejects.toMatchObject({ response: { errors: [{ code: 'GEOFENCE_UNAVAILABLE' }] } });
  });

  it('verifies inside the branch fence, audits and notifies', async () => {
    const deps = depsWithEnabled();
    deps.presenceVerification.findUnique.mockResolvedValue(pendingVerification() as never);
    deps.geofence.findFirst.mockResolvedValue(FENCE as never);
    geofenceSvc.evaluate.mockReturnValue({ distanceMeters: 50, radiusMeters: 100, inside: true });
    deps.presenceVerification.update.mockResolvedValue({
      id: 'pv1',
      status: 'VERIFIED',
      dueAt: new Date('2026-09-02T10:02:00.000Z'),
      verifiedAt: NOW,
      branchId: 'b1',
      distanceMeters: 50,
      geofenceRadiusMeters: 100,
    } as never);

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.verifyPresence('c1', 'pv1', { latitude: 40.7129, longitude: -74.0055 }, 'u1', NOW);

    expect(result.status).toBe('VERIFIED');
    expect(result.inside).toBe(true);
    expect(deps.presenceVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'VERIFIED', verifiedAt: NOW, distanceMeters: 50 }),
      }),
    );
    expect(auditSvc.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'attendance.presence_verification.verified' }),
    );
    expect(notificationsSvc.createForUser).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'presence_verification.verified', recipientUserId: 'u1' }),
    );
  });

  it('flags an outside-geofence answer as OUTSIDE_GEOFENCE without leaking raw coordinates', async () => {
    const deps = depsWithEnabled();
    deps.presenceVerification.findUnique.mockResolvedValue(pendingVerification() as never);
    deps.geofence.findFirst.mockResolvedValue(FENCE as never);
    geofenceSvc.evaluate.mockReturnValue({ distanceMeters: 900, radiusMeters: 100, inside: false });
    deps.presenceVerification.update.mockResolvedValue({
      id: 'pv1',
      status: 'OUTSIDE_GEOFENCE',
      dueAt: new Date('2026-09-02T10:02:00.000Z'),
      verifiedAt: NOW,
      branchId: 'b1',
      distanceMeters: 900,
      geofenceRadiusMeters: 100,
    } as never);

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.verifyPresence('c1', 'pv1', { latitude: 40.7, longitude: -74.1 }, 'u1', NOW);

    expect(result.status).toBe('OUTSIDE_GEOFENCE');
    expect(result.inside).toBe(false);
    expect(auditSvc.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'attendance.presence_verification.outside_geofence',
        after: expect.not.objectContaining({ latitude: expect.anything() }),
      }),
    );
    expect(notificationsSvc.createForUser).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'presence_verification.outside_geofence' }),
    );
  });

  it('is idempotent for an already-resolved verification: no re-evaluation, no notification', async () => {
    const deps = depsWithEnabled();
    deps.presenceVerification.findUnique.mockResolvedValue(
      pendingVerification({ status: 'VERIFIED', verifiedAt: NOW }) as never,
    );

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.verifyPresence('c1', 'pv1', { latitude: 40.7, longitude: -74.0 }, 'u1', NOW);

    expect(result.status).toBe('VERIFIED');
    expect(geofenceSvc.evaluate).not.toHaveBeenCalled();
    expect(deps.presenceVerification.update).not.toHaveBeenCalled();
    expect(notificationsSvc.createForUser).not.toHaveBeenCalled();
  });
});

describe('AttendanceService — manager presence verification list', () => {
  beforeEach(() => vi.clearAllMocks());

  function rows() {
    return [
      { id: 'v1', employeeId: 'e1', employee: { firstName: 'Ann', lastName: 'A', employeeNumber: 'E1' }, branchId: 'b1', branch: { id: 'b1', name: 'Main Branch' }, dueAt: new Date('2026-09-02T09:35:00.000Z'), verifiedAt: null, status: 'VERIFIED', distanceMeters: null, geofenceRadiusMeters: null },
      { id: 'v2', employeeId: 'e2', employee: { firstName: 'Bob', lastName: 'B', employeeNumber: 'E2' }, branchId: 'b1', branch: { id: 'b1', name: 'Main Branch' }, dueAt: new Date('2026-09-02T09:36:00.000Z'), verifiedAt: null, status: 'MISSED', distanceMeters: null, geofenceRadiusMeters: null },
      { id: 'v3', employeeId: 'e3', employee: { firstName: 'Cid', lastName: 'C', employeeNumber: 'E3' }, branchId: 'b1', branch: { id: 'b1', name: 'Main Branch' }, dueAt: new Date('2026-09-02T09:37:00.000Z'), verifiedAt: null, status: 'OUTSIDE_GEOFENCE', distanceMeters: 900, geofenceRadiusMeters: 100 },
      { id: 'v4', employeeId: 'e4', employee: { firstName: 'Dev', lastName: 'D', employeeNumber: 'E4' }, branchId: 'b1', branch: { id: 'b1', name: 'Main Branch' }, dueAt: new Date('2026-09-02T09:38:00.000Z'), verifiedAt: null, status: 'PENDING', distanceMeters: null, geofenceRadiusMeters: null },
    ] as never[];
  }

  it('prioritizes exceptions (missed, outside) above pending and verified', async () => {
    const deps = createDeps();
    deps.company.findUnique.mockResolvedValue({ settings: {} }); // disabled => reconcile is a no-op
    deps.presenceVerification.findMany.mockResolvedValue(rows());

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.listPresenceVerifications('c1');

    expect(result.map((r) => r.status)).toEqual(['MISSED', 'OUTSIDE_GEOFENCE', 'PENDING', 'VERIFIED']);
  });

  it('applies the status filter and the caller scope to the query', async () => {
    const deps = createDeps();
    deps.company.findUnique.mockResolvedValue({ settings: {} });
    deps.presenceVerification.findMany.mockResolvedValue([]);
    const scoped = {
      employeeWhere: async () => undefined,
      employeeRelationWhere: async () => ({ employee: { branchId: 'b1' } }),
      shiftQueryScope: async () => ({ shiftWhere: undefined, assignmentEmployeeWhere: undefined }),
      branchWhere: async () => undefined,
      departmentWhere: async () => undefined,
      teamWhere: async () => undefined,
      positionWhere: async () => undefined,
    };

    const service = new AttendanceService(deps.prisma, scoped, geofenceSvc, auditSvc, notificationsSvc);
    const result = await service.listPresenceVerifications('c1', 'm1', ['MISSED']);

    expect(result).toEqual([]);
    const queryWhere = deps.presenceVerification.findMany.mock.calls.at(-1)?.[0]?.where;
    expect(queryWhere).toMatchObject({ companyId: 'c1', status: { in: ['MISSED'] }, employee: { branchId: 'b1' } });
  });
});

describe('AttendanceService — daily records date normalization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults a missing date to the current UTC day', async () => {
    const deps = createDeps();
    deps.attendanceRecord.findMany.mockResolvedValue([]);

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await service.findDailyRecords('c1', undefined as never);

    const queryWhere = deps.attendanceRecord.findMany.mock.calls.at(-1)?.[0]?.where;
    const expected = new Date(new Date().toISOString().slice(0, 10));
    expect(queryWhere.workDate.getTime()).toBe(expected.getTime());
  });

  it('normalizes an explicit date and falls back to today on malformed input', async () => {
    const deps = createDeps();
    deps.attendanceRecord.findMany.mockResolvedValue([]);

    const service = new AttendanceService(deps.prisma, companyWideScopeFilter(), geofenceSvc, auditSvc, notificationsSvc);
    await service.findDailyRecords('c1', 'not-a-date');

    const queryWhere = deps.attendanceRecord.findMany.mock.calls.at(-1)?.[0]?.where;
    const expected = new Date(new Date().toISOString().slice(0, 10));
    expect(queryWhere.workDate.getTime()).toBe(expected.getTime());
    expect(Number.isNaN(queryWhere.workDate.getTime())).toBe(false);
  });
});
