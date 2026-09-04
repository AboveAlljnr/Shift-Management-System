import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { QualificationsService } from './qualifications.service';

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
  const skill = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  };
  const certification = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  };
  const employee = { findFirst: vi.fn() };
  const employeeSkill = { deleteMany: vi.fn(), createMany: vi.fn() };
  const employeeCertification = { deleteMany: vi.fn(), createMany: vi.fn() };
  const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ employeeSkill, employeeCertification } as any),
  );
  const prisma = {
    skill,
    certification,
    employee,
    employeeSkill,
    employeeCertification,
    $transaction,
  };
  return { prisma, skill, certification, employee, employeeSkill, employeeCertification };
}

describe('QualificationsService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('skill catalog', () => {
    it('lists company skills with usage counts', async () => {
      const { prisma, skill } = createDeps();
      skill.findMany.mockResolvedValue([{ id: 'sk1', name: 'Cash Handling' }]);

      const service = new QualificationsService(prisma as any, companyWideScopeFilter());
      const result = await service.listSkills('c1');

      expect(skill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'c1' } }),
      );
      expect(result).toHaveLength(1);
    });

    it('creates a skill with a normalized unique code', async () => {
      const { skill } = createDeps();
      skill.findFirst.mockResolvedValue(null);
      skill.create.mockResolvedValue({ id: 'sk1' });

      const service = new QualificationsService({ skill } as any, companyWideScopeFilter());
      const result = await service.createSkill('c1', { name: 'Cash Handling', code: 'cash' });

      expect(skill.create).toHaveBeenCalledWith({
        data: { companyId: 'c1', name: 'Cash Handling', code: 'CASH' },
      });
      expect(result).toEqual({ id: 'sk1' });
    });

    it('rejects a duplicate skill code within the company', async () => {
      const { skill } = createDeps();
      skill.findFirst.mockResolvedValue({ id: 'other' });

      const service = new QualificationsService({ skill } as any, companyWideScopeFilter());
      await expect(
        service.createSkill('c1', { name: 'Dup', code: 'CASH' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(skill.create).not.toHaveBeenCalled();
    });

    it('throws NotFound when updating an unknown skill', async () => {
      const { skill } = createDeps();
      skill.findFirst.mockResolvedValue(null);

      const service = new QualificationsService({ skill } as any, companyWideScopeFilter());
      await expect(
        service.updateSkill('c1', 'nope', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('certification catalog', () => {
    it('creates a certification with validity period', async () => {
      const { certification } = createDeps();
      certification.findFirst.mockResolvedValue(null);
      certification.create.mockResolvedValue({ id: 'cr1' });

      const service = new QualificationsService({ certification } as any, companyWideScopeFilter());
      const result = await service.createCertification('c1', {
        name: 'Food Handling',
        code: 'food',
        validityPeriodDays: 365,
      });

      expect(certification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'c1',
            code: 'FOOD',
            validityPeriodDays: 365,
          }),
        }),
      );
      expect(result).toEqual({ id: 'cr1' });
    });

    it('rejects a duplicate certification code', async () => {
      const { certification } = createDeps();
      certification.findFirst.mockResolvedValue({ id: 'other' });

      const service = new QualificationsService({ certification } as any, companyWideScopeFilter());
      await expect(
        service.createCertification('c1', { name: 'Dup', code: 'FOOD' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('employee qualification assignment', () => {
    it('replaces an employee\'s skills transactionally', async () => {
      const { prisma, employee, employeeSkill, skill } = createDeps();
      employee.findFirst.mockResolvedValue({ id: 'e1' });
      skill.count.mockResolvedValue(1);
      employeeSkill.deleteMany.mockResolvedValue({ count: 0 });
      employeeSkill.createMany.mockResolvedValue({ count: 1 });
      prisma.employee.findFirst = employee.findFirst;

      const service = new QualificationsService(prisma as any, companyWideScopeFilter());
      await service.setEmployeeSkills(
        'c1',
        'e1',
        { skills: [{ skillId: 'sk1', proficiencyLevel: 'advanced' }] },
        'm1',
      );

      expect(employeeSkill.deleteMany).toHaveBeenCalledWith({ where: { employeeId: 'e1' } });
      expect(employeeSkill.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [{ employeeId: 'e1', skillId: 'sk1', proficiencyLevel: 'advanced' }],
        }),
      );
    });

    it('replaces an employee\'s certifications transactionally', async () => {
      const { prisma, employee, employeeCertification, certification } = createDeps();
      employee.findFirst.mockResolvedValue({ id: 'e1' });
      certification.count.mockResolvedValue(1);
      employeeCertification.deleteMany.mockResolvedValue({ count: 0 });
      employeeCertification.createMany.mockResolvedValue({ count: 1 });
      prisma.employee.findFirst = employee.findFirst;

      const service = new QualificationsService(prisma as any, companyWideScopeFilter());
      await service.setEmployeeCertifications(
        'c1',
        'e1',
        { certifications: [{ certificationId: 'cr1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z' }] },
        'm1',
      );

      expect(employeeCertification.deleteMany).toHaveBeenCalledWith({ where: { employeeId: 'e1' } });
      expect(employeeCertification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            {
              employeeId: 'e1',
              certificationId: 'cr1',
              issuedAt: new Date('2026-01-01T00:00:00.000Z'),
              expiresAt: new Date('2027-01-01T00:00:00.000Z'),
              issuer: undefined,
            },
          ],
        }),
      );
    });

    it('rejects assignment when a skill does not belong to the company', async () => {
      const { prisma, employee, skill } = createDeps();
      employee.findFirst.mockResolvedValue({ id: 'e1' });
      skill.count.mockResolvedValue(0);

      const service = new QualificationsService(prisma as any, companyWideScopeFilter());
      await expect(
        service.setEmployeeSkills('c1', 'e1', { skills: [{ skillId: 'foreign' }] }),
      ).rejects.toThrow();
      expect(prisma.employeeSkill.deleteMany).not.toHaveBeenCalled();
    });
  });
});