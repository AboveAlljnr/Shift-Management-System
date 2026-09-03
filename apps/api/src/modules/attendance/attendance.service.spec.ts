import { NotFoundException } from '@nestjs/common';
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
  const employee = { findFirst: vi.fn() };
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
    $transaction,
  };
  return { prisma, attendanceEvent, attendanceRecord, breakRecord, attendanceCorrection };
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
      { attendanceEvent, attendanceRecord, attendanceCorrection, $transaction: vi.fn() } as any, companyWideScopeFilter()
    );
    const result = await service.recordClockEvent('c1', 'e1', clockInDto);

    expect(result).toEqual({ status: 'deduplicated', eventId: 'ev1' });
    expect(attendanceEvent.findFirst).toHaveBeenCalledWith({
      where: { idempotencyKey: clockInDto.idempotencyKey, companyId: 'c1' },
    });
    expect(attendanceRecord.findUnique).not.toHaveBeenCalled();
  });

  it('never deduplicates an event whose idempotency key exists under another company', async () => {
    const { prisma, attendanceRecord, attendanceEvent } = createDeps();
    attendanceEvent.findFirst.mockResolvedValue(null);
    attendanceRecord.findUnique.mockResolvedValue(null);
    attendanceRecord.create.mockResolvedValue({ id: 'rec1' });
    attendanceEvent.create.mockResolvedValue({ id: 'evX' });
    attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(prisma, companyWideScopeFilter());
    const result = await service.recordClockEvent('c1', 'e1', clockInDto);

    expect(result.status).toBe('recorded');
    expect(attendanceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ idempotencyKey: clockInDto.idempotencyKey, companyId: 'c1' }),
      }),
    );
  });

  it('creates a daily record on first clock_in and stores the earliest clock-in', async () => {
    const { prisma, attendanceRecord, attendanceEvent } = createDeps();
    attendanceEvent.findFirst.mockResolvedValue(null);
    attendanceRecord.findUnique.mockResolvedValue(null);
    attendanceRecord.create.mockResolvedValue({ id: 'rec1' });
    attendanceEvent.create.mockResolvedValue({ id: 'ev2' });
    attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(prisma, companyWideScopeFilter());
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

    const service = new AttendanceService(prisma, companyWideScopeFilter());
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

    const service = new AttendanceService(prisma, companyWideScopeFilter());
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

    const service = new AttendanceService(prisma, companyWideScopeFilter());
    await expect(
      service.recordCorrection('c1', { attendanceRecordId: 'rec9', field: 'status', newValue: 'present', reason: 'fix' }, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records the correction with a mandatory reason and updates the status field', async () => {
    const { prisma, attendanceRecord, attendanceCorrection } = createDeps();
    attendanceRecord.findFirst.mockResolvedValue({ id: 'rec1', companyId: 'c1' });
    attendanceCorrection.create.mockResolvedValue({ id: 'co1' });
    attendanceRecord.update.mockResolvedValue({});

    const service = new AttendanceService(prisma, companyWideScopeFilter());
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