import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

interface JwtPayload {
  sub: string;
  email: string;
  companyId: string;
  membershipId: string;
  roles?: string[];
  role?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  // ADR-004: The active CompanyMembership is validated on every request.
  // A revoked, suspended, or missing membership must reject even a valid token.
  async validate(payload: JwtPayload) {
    const membership = await this.prisma.companyMembership.findUnique({
      where: { id: payload.membershipId },
      select: { id: true, userId: true, companyId: true, status: true },
    });

    if (!membership || membership.userId !== payload.sub) {
      throw new UnauthorizedException('Company membership no longer exists');
    }

    if (membership.status !== 'active') {
      throw new UnauthorizedException('Company membership is no longer active');
    }

    // The company scoped in the token must match the membership's company.
    if (membership.companyId !== payload.companyId) {
      throw new UnauthorizedException('Company context mismatch');
    }

    return {
      id: payload.sub,
      email: payload.email,
      companyId: membership.companyId,
      membershipId: membership.id,
      roles: payload.roles || (payload.role ? [payload.role] : []),
    };
  }
}
