import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn({ attendanceEvent, attendanceRecord, break: breakRecord, attendanceCorrection } as any),
  );
  const prisma = {
    attendanceEvent,
    attendanceRecord,
    break: breakRecord,
    attendanceCorrection,
    employee,
    geofence,
    $transaction,
  };
  return { prisma, attendanceEvent, attendanceRecord, breakRecord, attendanceCorrection, employee, geofence };
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

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc);
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

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc);
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

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc);
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

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc);
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

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc);
    await expect(
      service.recordCorrection('c1', { attendanceRecordId: 'rec9', field: 'status', newValue: 'present', reason: 'fix' }, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records the correction with a mandatory reason and updates the status field', async () => {
    const { prisma, attendanceRecord, attendanceCorrection } = createDeps();
    attendanceRecord.findFirst.mockResolvedValue({ id: 'rec1', companyId: 'c1' });
    attendanceCorrection.create.mockResolvedValue({ id: 'co1' });
    attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc);
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

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc);
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

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc);
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

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc);
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
    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc);
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

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc);
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

    const service = new AttendanceService(prisma, companyWideScopeFilter(), geofenceSvc, auditSvc);
    const result = await service.recordClockEvent('c1', 'e1', geoDto(-74.0, 40.71));

    expect(result.status).toBe('recorded');
    expect(geofence.findFirst).not.toHaveBeenCalled();
    expect(geofenceSvc.evaluate).not.toHaveBeenCalled();
    expect(attendanceEvent.create).toHaveBeenCalled();
  });
});