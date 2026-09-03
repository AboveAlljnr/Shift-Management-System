import { BadRequestException } from '@nestjs/common';
import { PaginationQuerySchema, RegisterCompanySchema } from '@sms/shared';
import { describe, it, expect } from 'vitest';

import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  it('passes valid data through unchanged', () => {
    const pipe = new ZodValidationPipe(RegisterCompanySchema);
    const dto = {
      email: 'owner@acme.test',
      password: 'Passw0rd!123',
      name: 'Ada Owner',
      companyName: 'Acme Corp',
      companySlug: 'acme-corp',
    };
    expect(pipe.transform(dto)).toEqual({ ...dto, timezone: 'UTC' });
  });

  it('applies zod transforms (coerced query numbers + defaults)', () => {
    const pipe = new ZodValidationPipe(PaginationQuerySchema);
    expect(pipe.transform({ page: '2', limit: '5' })).toEqual({
      page: 2,
      limit: 5,
      sortOrder: 'desc',
    });
  });

  it('rejects invalid data with a BadRequestException', () => {
    const pipe = new ZodValidationPipe(RegisterCompanySchema);
    expect(() =>
      pipe.transform({ email: 'owner@acme.test', password: 'x', companySlug: 'bad slug!' }),
    ).toThrow(BadRequestException);
  });

  it('rejects null / non-object payloads', () => {
    const pipe = new ZodValidationPipe(RegisterCompanySchema);
    expect(() => pipe.transform(null)).toThrow(BadRequestException);
  });
});