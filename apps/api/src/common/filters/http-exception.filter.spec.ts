import {
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { HttpExceptionFilter } from './http-exception.filter';

function runFilter(exception: unknown): { statusCode: number; body: Record<string, unknown> } {
  const filter = new HttpExceptionFilter();
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const response = { status };
  const request = { method: 'GET', url: '/api/v1/test' };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  };

  filter.catch(exception, host as never);
  return { statusCode: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

describe('HttpExceptionFilter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns a client-safe message for 4xx HttpExceptions', () => {
    const { statusCode, body } = runFilter(new BadRequestException('invalid input'));
    expect(statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(body.message).toBe('invalid input');
  });

  it('does NOT leak the internal message to the client for a 5xx HttpException', () => {
    const err = new InternalServerErrorException('connect ECONNREFUSED 127.0.0.1:5432');
    const { statusCode, body } = runFilter(err);
    expect(statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.message).toBe('Internal server error');
    expect(String(body.message)).not.toContain('ECONNREFUSED');
  });

  it('does NOT leak a raw internal error message/path for unexpected 500s', () => {
    const raw = new Error('C:\\repo\\apps\\api\\dist\\modules\\auth\\auth.service.js:324 connect ECONNREFUSED');
    const { statusCode, body } = runFilter(raw);
    expect(statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.message).toBe('Internal server error');
    expect(String(body.message)).not.toContain('auth.service');
    expect(String(body.message)).not.toContain('ECONNREFUSED');
    expect(String(body.message)).not.toContain('C:');
  });

  it('maps unknown thrown values to 500 with a generic message', () => {
    const { statusCode, body } = runFilter('boom');
    expect(statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.message).toBe('Internal server error');
  });
});
