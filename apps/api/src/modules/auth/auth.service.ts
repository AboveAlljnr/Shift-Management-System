import { createHash, randomBytes } from 'crypto';

import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ROLE_PERMISSION_TEMPLATES } from '@sms/shared';
import type { LoginDto, RegisterCompanyDto, AuthTokens } from '@sms/shared';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';


const SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterCompanyDto): Promise<AuthTokens> {
    // Check company slug available
    const existingCompany = await this.prisma.company.findUnique({
      where: { slug: dto.companySlug },
    });
    if (existingCompany) {
      throw new ConflictException('Company slug is already taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    // Create Company, User, CompanyMembership (Owner), Default Branch, EmploymentType, Role in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: dto.companyName,
          slug: dto.companySlug,
          timezone: dto.timezone || 'UTC',
        },
      });

      // Find or create User
      let user = await tx.user.findUnique({
        where: { email: dto.email },
      });

      if (!user) {
        user = await tx.user.create({
          data: {
            email: dto.email,
            passwordHash,
            name: dto.name,
            status: 'active',
          },
        });
      }

      // Create CompanyMembership
      const membership = await tx.companyMembership.create({
        data: {
          userId: user.id,
          companyId: company.id,
          status: 'active',
          joinedAt: new Date(),
        },
      });

      // Create default Owner role
      const ownerRole = await tx.role.create({
        data: {
          companyId: company.id,
          name: 'Owner',
          code: 'OWNER',
          isSystemRole: true,
        },
      });

      // Grant the Owner role the canonical Owner permission set (docs/03-auth/roles.md).
      const ownerActions = [...(ROLE_PERMISSION_TEMPLATES['OWNER'] ?? [])];
      const ownerPermissions = await tx.permission.findMany({
        where: { action: { in: ownerActions } },
        select: { id: true },
      });
      if (ownerPermissions.length > 0) {
        await tx.rolePermission.createMany({
          data: ownerPermissions.map((permission) => ({
            roleId: ownerRole.id,
            permissionId: permission.id,
          })),
          skipDuplicates: true,
        });
      }

      // Assign Owner role to membership
      await tx.userRole.create({
        data: {
          membershipId: membership.id,
          roleId: ownerRole.id,
        },
      });

      // Create company-wide AccessScope for owner
      await tx.accessScope.create({
        data: {
          membershipId: membership.id,
          scopeType: 'company',
          scopeId: company.id,
        },
      });

      // Create Default Branch & Full-time Employment Type
      const defaultBranch = await tx.branch.create({
        data: {
          companyId: company.id,
          name: 'Main Branch',
          code: 'MAIN',
          timezone: dto.timezone || 'UTC',
        },
      });

      const fullTimeType = await tx.employmentType.create({
        data: {
          companyId: company.id,
          name: 'Full Time',
          code: 'FT',
        },
      });

      // Create Initial Employee profile for Owner
      await tx.employee.create({
        data: {
          companyId: company.id,
          userId: user.id,
          employeeNumber: 'EMP-001',
          firstName: dto.name.split(' ')[0] || dto.name,
          lastName: dto.name.split(' ').slice(1).join(' ') || 'Admin',
          email: dto.email,
          employmentTypeId: fullTimeType.id,
          branchId: defaultBranch.id,
          hireDate: new Date(),
        },
      });

      return { user, company, membership, roles: ['OWNER'] };
    });

    return this.issueTokens(
      result.user.id,
      result.user.email,
      result.company.id,
      result.membership.id,
      result.roles,
    );
  }

  async login(dto: LoginDto, companySlug?: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        memberships: {
          include: {
            company: true,
            roles: {
              include: { role: true },
            },
          },
        },
      },
    });

    if (!user) {
      await this.audit.record({ action: 'auth.login.failure', resource: 'user', resourceId: dto.email });
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValidPassword = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValidPassword) {
      await this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: 'auth.login.failure',
        resource: 'user',
        resourceId: user.id,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'active') {
      await this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: 'auth.login.blocked',
        resource: 'user',
        resourceId: user.id,
      });
      throw new ForbiddenException('User account is suspended or pending verification');
    }

    // Resolve membership: either matching companySlug or active first membership
    const targetMembership = user.memberships.find(
      (m) =>
        m.status === 'active' && (!companySlug || m.company.slug === companySlug),
    );

    if (!targetMembership) {
      if (companySlug) {
        throw new NotFoundException(`No active membership found for company: ${companySlug}`);
      }
      throw new ForbiddenException('No active company membership found for user');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const roles = targetMembership.roles.map((r) => r.role.code);

    await this.audit.record({
      companyId: targetMembership.companyId,
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.login.success',
      resource: 'user',
      resourceId: user.id,
    });

    return this.issueTokens(
      user.id,
      user.email,
      targetMembership.companyId,
      targetMembership.id,
      roles,
    );
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored || stored.isRevoked || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Revoke old token (rotation)
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { isRevoked: true },
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: stored.userId },
      include: {
        memberships: {
          include: {
            roles: { include: { role: true } },
          },
        },
      },
    });

    const targetMembership = stored.membershipId
      ? user.memberships.find((m) => m.id === stored.membershipId && m.status === 'active')
      : user.memberships.find((m) => m.status === 'active');

    if (!targetMembership) {
      throw new ForbiddenException('Company membership is inactive or revoked');
    }

    const roles = targetMembership.roles.map((r) => r.role.code);

    return this.issueTokens(
      user.id,
      user.email,
      targetMembership.companyId,
      targetMembership.id,
      roles,
    );
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const result = await this.prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { isRevoked: true },
    });

    if (result.count > 0) {
      const stored = await this.prisma.refreshToken.findUnique({
        where: { tokenHash },
        select: { userId: true, membershipId: true },
      });
      const user = stored
        ? await this.prisma.user.findUnique({
            where: { id: stored.userId },
            select: { email: true },
          })
        : null;
      const companyId = stored?.membershipId
        ? (
            await this.prisma.companyMembership.findUnique({
              where: { id: stored.membershipId },
              select: { companyId: true },
            })
          )?.companyId
        : undefined;
      await this.audit.record({
        companyId,
        actorId: stored?.userId,
        actorEmail: user?.email,
        action: 'auth.logout',
        resource: 'user',
        resourceId: stored?.userId,
      });
    }
  }

  private async issueTokens(
    userId: string,
    email: string,
    companyId: string,
    membershipId: string,
    roles: string[],
  ): Promise<AuthTokens> {
    const payload = {
      sub: userId,
      email,
      companyId,
      membershipId,
      roles,
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
    const rawRefreshToken = this.jwtService.sign(
      { ...payload, jti: randomBytes(16).toString('hex') },
      {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn,
      },
    );

    const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        membershipId,
        tokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: 900,
    };
  }
}
