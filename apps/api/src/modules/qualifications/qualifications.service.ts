import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateCertificationDto,
  CreateSkillDto,
  SetEmployeeCertificationsDto,
  SetEmployeeSkillsDto,
  UpdateCertificationDto,
  UpdateSkillDto,
} from '@sms/shared';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ScopeFilterService } from '../authorization/scope-filter.service';

@Injectable()
export class QualificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeFilter: ScopeFilterService,
  ) {}

  // ---- Skill catalog (company-scoped) ----

  async listSkills(companyId: string) {
    return this.prisma.skill.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { employeeSkills: true } } },
    });
  }

  async createSkill(companyId: string, dto: CreateSkillDto) {
    await this.assertCompanySkillCodeUnique(companyId, dto.code);
    return this.prisma.skill.create({
      data: { companyId, name: dto.name.trim(), code: dto.code.trim().toUpperCase() },
    });
  }

  async updateSkill(companyId: string, id: string, dto: UpdateSkillDto) {
    await this.findSkillInCompany(companyId, id);
    if (dto.code) {
      await this.assertCompanySkillCodeUnique(companyId, dto.code, id);
    }
    return this.prisma.skill.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        code: dto.code?.trim().toUpperCase(),
        isActive: dto.isActive,
      },
    });
  }

  // ---- Certification catalog (company-scoped) ----

  async listCertifications(companyId: string) {
    return this.prisma.certification.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { employeeCertifications: true } } },
    });
  }

  async createCertification(companyId: string, dto: CreateCertificationDto) {
    await this.assertCompanyCertificationCodeUnique(companyId, dto.code);
    return this.prisma.certification.create({
      data: {
        companyId,
        name: dto.name.trim(),
        code: dto.code.trim().toUpperCase(),
        validityPeriodDays: dto.validityPeriodDays,
      },
    });
  }

  async updateCertification(companyId: string, id: string, dto: UpdateCertificationDto) {
    await this.findCertificationInCompany(companyId, id);
    if (dto.code) {
      await this.assertCompanyCertificationCodeUnique(companyId, dto.code, id);
    }
    return this.prisma.certification.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        code: dto.code?.trim().toUpperCase(),
        validityPeriodDays: dto.validityPeriodDays,
        isActive: dto.isActive,
      },
    });
  }

  // ---- Employee qualifications (scoped to the caller's granted scope) ----

  async getEmployeeQualifications(companyId: string, employeeId: string, membershipId?: string) {
    await this.assertEmployeeInScope(companyId, employeeId, membershipId);
    return this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
        skills: {
          include: { skill: true },
          orderBy: { createdAt: 'asc' },
        },
        certifications: {
          include: { certification: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async setEmployeeSkills(companyId: string, employeeId: string, dto: SetEmployeeSkillsDto, membershipId?: string) {
    await this.assertEmployeeInScope(companyId, employeeId, membershipId);
    const skillIds = dto.skills.map((s) => s.skillId);
    await this.validateSkills(companyId, skillIds);

    await this.prisma.$transaction(async (tx) => {
      await tx.employeeSkill.deleteMany({ where: { employeeId } });
      if (skillIds.length > 0) {
        await tx.employeeSkill.createMany({
          data: dto.skills.map((s) => ({
            employeeId,
            skillId: s.skillId,
            proficiencyLevel: s.proficiencyLevel,
          })),
          skipDuplicates: true,
        });
      }
    });

    return this.getEmployeeQualifications(companyId, employeeId, membershipId);
  }

  async setEmployeeCertifications(
    companyId: string,
    employeeId: string,
    dto: SetEmployeeCertificationsDto,
    membershipId?: string,
  ) {
    await this.assertEmployeeInScope(companyId, employeeId, membershipId);
    const certificationIds = dto.certifications.map((c) => c.certificationId);
    await this.validateCertifications(companyId, certificationIds);

    await this.prisma.$transaction(async (tx) => {
      await tx.employeeCertification.deleteMany({ where: { employeeId } });
      if (certificationIds.length > 0) {
        await tx.employeeCertification.createMany({
          data: dto.certifications.map((c) => ({
            employeeId,
            certificationId: c.certificationId,
            issuedAt: new Date(c.issuedAt),
            expiresAt: c.expiresAt ? new Date(c.expiresAt) : null,
            issuer: c.issuer,
          })),
          skipDuplicates: true,
        });
      }
    });

    return this.getEmployeeQualifications(companyId, employeeId, membershipId);
  }

  // ---- Helpers ----

  private async findSkillInCompany(companyId: string, id: string) {
    const skill = await this.prisma.skill.findFirst({ where: { id, companyId } });
    if (!skill) {
      throw new NotFoundException(`Skill with ID ${id} not found`);
    }
    return skill;
  }

  private async findCertificationInCompany(companyId: string, id: string) {
    const certification = await this.prisma.certification.findFirst({ where: { id, companyId } });
    if (!certification) {
      throw new NotFoundException(`Certification with ID ${id} not found`);
    }
    return certification;
  }

  private async assertCompanySkillCodeUnique(companyId: string, code: string, exceptId?: string) {
    const existing = await this.prisma.skill.findFirst({
      where: { companyId, code: code.trim().toUpperCase(), NOT: exceptId ? { id: exceptId } : undefined },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`A skill with code '${code}' already exists`);
    }
    return existing;
  }

  private async assertCompanyCertificationCodeUnique(
    companyId: string,
    code: string,
    exceptId?: string,
  ) {
    const existing = await this.prisma.certification.findFirst({
      where: { companyId, code: code.trim().toUpperCase(), NOT: exceptId ? { id: exceptId } : undefined },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`A certification with code '${code}' already exists`);
    }
    return existing;
  }

  private async validateSkills(companyId: string, skillIds: string[]) {
    const count = await this.prisma.skill.count({
      where: { id: { in: [...new Set(skillIds)] }, companyId },
    });
    if (count !== new Set(skillIds).size) {
      throw new BadRequestException('One or more skills do not belong to this company');
    }
  }

  private async validateCertifications(companyId: string, certificationIds: string[]) {
    const count = await this.prisma.certification.count({
      where: { id: { in: [...new Set(certificationIds)] }, companyId },
    });
    if (count !== new Set(certificationIds).size) {
      throw new BadRequestException('One or more certifications do not belong to this company');
    }
  }

  private async assertEmployeeInScope(
    companyId: string,
    employeeId: string,
    membershipId?: string,
  ) {
    const where: Record<string, any> = { id: employeeId, companyId };
    if (membershipId) {
      const scopeWhere = await this.scopeFilter.employeeWhere(membershipId, companyId);
      if (scopeWhere) {
        where.AND = [scopeWhere];
      }
    }
    const employee = await this.prisma.employee.findFirst({ where, select: { id: true } });
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${employeeId} not found in scope`);
    }
    return employee;
  }
}