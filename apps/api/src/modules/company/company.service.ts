import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        branches: true,
        subscription: {
          include: { plan: true },
        },
      },
    });

    if (!company) {
      throw new NotFoundException(`Company with ID ${id} not found`);
    }

    return company;
  }

  async findBySlug(slug: string) {
    const company = await this.prisma.company.findUnique({
      where: { slug },
      include: {
        branches: true,
        subscription: {
          include: { plan: true },
        },
      },
    });

    if (!company) {
      throw new NotFoundException(`Company with slug ${slug} not found`);
    }

    return company;
  }

  async updateSettings(companyId: string, settings: Record<string, any>) {
    return this.prisma.company.update({
      where: { id: companyId },
      data: { settings },
    });
  }
}
