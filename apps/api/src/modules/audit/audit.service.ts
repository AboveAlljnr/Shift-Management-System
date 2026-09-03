import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface AuditRecordInput {
  /** The tenant (company) the action belongs to. Nullable for platform-level actions. */
  companyId?: string;
  /** The authenticated user performing the action. Nullable for system actions. */
  actorId?: string;
  actorEmail?: string;
  /** Machine-readable action, e.g. "auth.login", "schedule.publish". */
  action: string;
  /** Resource type, e.g. "company", "employee", "shift". */
  resource: string;
  resourceId?: string;
  /** Snapshot of state before the change (for sensitive mutations). */
  before?: Record<string, unknown>;
  /** Snapshot of state after the change (for sensitive mutations). */
  after?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * Central audit logging (security.md → Auditability).
 * Security-sensitive actions are appends to the AuditLog and are never
 * overwritten or deleted (append-only, preserving audit integrity).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist an audit entry. This is intentionally a single write so callers
   * can wrap it in a transaction alongside the mutating operation when atomic
   * audit integrity is required.
   */
  async record(input: AuditRecordInput) {
    return this.prisma.auditLog.create({
      data: {
        companyId: input.companyId ?? null,
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId,
        before: (input.before as object) ?? undefined,
        after: (input.after as object) ?? undefined,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        requestId: input.requestId,
      },
    });
  }

  /** Query audit logs for a company, newest first, with optional filters. */
  async findByCompany(
    companyId: string,
    opts: {
      actorId?: string;
      resource?: string;
      action?: string;
      from?: Date;
      to?: Date;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

    const where = {
      companyId,
      ...(opts.actorId ? { actorId: opts.actorId } : {}),
      ...(opts.resource ? { resource: opts.resource } : {}),
      ...(opts.action ? { action: opts.action } : {}),
      ...(opts.from || opts.to
        ? {
            occurredAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
      }),
    ]);

    return { items, total, page, limit };
  }
}
