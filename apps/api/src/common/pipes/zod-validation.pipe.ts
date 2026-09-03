import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

function formatIssue(issues: { path: (string | number)[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/**
 * Validates and transforms a request value (body, query, param) against a
 * Zod schema from @sms/shared. Compiles the schema to an interface type only,
 * so class-validator's ValidationPipe cannot act on it; this pipe restores
 * actual request validation for those DTOs.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(formatIssue(result.error.issues));
    }
    return result.data;
  }
}