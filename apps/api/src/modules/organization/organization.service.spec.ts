import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { OrganizationService } from './organization.service';

function createDeps(scope?: { unrestricted: boolean; buckets: Record<string, string[]> }) {
  const branch = { findFirst: vi.fn() };
  const geofence = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
  const scopeFilter = { resolveScope: vi.fn() };
  const audit = { record: vi.fn() };

  scopeFilter.resolveScope.mockResolvedValue(
    scope ?? { unrestricted: true, buckets: { branchIds: [], departmentIds: [], teamIds: [], employeeIds: [] } },
  );

  const prisma = { branch, geofence };
  return { prisma, branch, geofence, scopeFilter, audit, service: new OrganizationService(prisma, scopeFilter as never, audit as never) };
}

const dto = { latitude: 40.7128, longitude: -74.006, radiusMeters: 100, isActive: true };

describe('OrganizationService — branch geofence configure', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects configuring a geofence for a branch that belongs to another company (tenant-FK)', async () => {
    const { branch, service } = createDeps();
    branch.findFirst.mockResolvedValue(null);

    await expect(service.configureBranchGeofence('c1', 'b-other', dto, '')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a scoped (non-company-wide) manager configuring an inaccessible branch', async () => {
    const { branch, service } = createDeps({
      unrestricted: false,
      buckets: { branchIds: ['b1'], departmentIds: [], teamIds: [], employeeIds: [] },
    });
    branch.findFirst.mockResolvedValue({ id: 'b2', name: 'Remote' });

    await expect(service.configureBranchGeofence('c1', 'b2', dto, 'm1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates a geofence for an unrestricted company member and audits the action', async () => {
    const { branch, geofence, audit, service } = createDeps({
      unrestricted: true,
      buckets: { branchIds: [], departmentIds: [], teamIds: [], employeeIds: [] },
    });
    branch.findFirst.mockResolvedValue({ id: 'b1', name: 'Downtown' });
    geofence.findFirst.mockResolvedValue(null);
    geofence.create.mockResolvedValue({ id: 'gf1', companyId: 'c1', branchId: 'b1', ...dto });

    const result = await service.configureBranchGeofence('c1', 'b1', dto, 'm1', { id: 'u1', email: 'a@x.com' });

    expect(geofence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'c1', branchId: 'b1', radiusMeters: 100, isActive: true }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'geofence.create', resource: 'geofence', resourceId: 'gf1' }),
    );
    expect(result).toEqual({ id: 'gf1', companyId: 'c1', branchId: 'b1', ...dto });
  });

  it('updates an existing geofence for a branch within a scoped managers grant', async () => {
    const { branch, geofence, audit, service } = createDeps({
      unrestricted: false,
      buckets: { branchIds: ['b1'], departmentIds: [], teamIds: [], employeeIds: [] },
    });
    branch.findFirst.mockResolvedValue({ id: 'b1', name: 'Downtown' });
    geofence.findFirst.mockResolvedValue({
      id: 'gf1',
      latitude: 0,
      longitude: 0,
      radiusMeters: 50,
      isActive: true,
    });
    geofence.update.mockResolvedValue({ id: 'gf1', companyId: 'c1', branchId: 'b1', ...dto });

    const result = await service.configureBranchGeofence('c1', 'b1', dto, 'm1');

    expect(geofence.update).toHaveBeenCalledWith({
      where: { id: 'gf1' },
      data: expect.objectContaining({ radiusMeters: 100 }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'geofence.update' }),
    );
    expect(result.radiusMeters).toBe(100);
  });

  it('returns null geofence for a branch with no fence configured (get)', async () => {
    const { branch, geofence, service } = createDeps({
      unrestricted: true,
      buckets: { branchIds: [], departmentIds: [], teamIds: [], employeeIds: [] },
    });
    branch.findFirst.mockResolvedValue({ id: 'b1', name: 'Downtown' });
    geofence.findFirst.mockResolvedValue(null);

    const result = await service.getBranchGeofence('c1', 'b1', 'm1');
    expect(result).toBeNull();
  });
});
