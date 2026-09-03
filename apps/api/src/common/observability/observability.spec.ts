import { afterEach, describe, expect, it, vi } from 'vitest';

import { JsonLogger } from './json-logger';
import { correlationId, getTrace, runWithTrace } from './trace-context';

describe('trace-context (correlation id propagation)', () => {
  it('returns "-" outside any request context', () => {
    expect(correlationId()).toBe('-');
    expect(getTrace()).toBeUndefined();
  });

  it('propagates the correlation id through the async call chain', async () => {
    const seen = await runWithTrace(
      { correlationId: 'abc-123', method: 'POST', path: '/auth/login' },
      async () => correlationId(),
    );
    expect(seen).toBe('abc-123');
    expect(correlationId()).toBe('-');
  });

  it('stops propagating outside the run scope', () => {
    runWithTrace({ correlationId: 'x', method: 'GET', path: '/x' }, () => {
      expect(correlationId()).toBe('x');
    });
    expect(correlationId()).toBe('-');
  });
});

describe('JsonLogger (structured output)', () => {
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  afterEach(() => {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
    vi.restoreAllMocks();
  });

  function captureStdout(fn: () => void): Record<string, unknown> {
    let line = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      line = String(chunk);
      return true;
    });
    fn();
    return JSON.parse(line);
  }

  it('emits a JSON object with level, message, timestamp, env, correlationId', () => {
    const rec = captureStdout(() => new JsonLogger().log('hello'));
    expect(rec.level).toBe('log');
    expect(rec.message).toBe('hello');
    expect(rec.env).toBeDefined();
    expect(typeof rec.timestamp).toBe('string');
    expect(rec.correlationId).toBe('-');
  });

  it('attaches the request correlation id from the active trace', () => {
    const rec = captureStdout(() =>
      runWithTrace({ correlationId: 'req-42', method: 'GET', path: '/api/v1/x' }, () =>
        new JsonLogger().log('inside request'),
      ),
    );
    expect(rec.correlationId).toBe('req-42');
    expect(rec.method).toBe('GET');
    expect(rec.path).toBe('/api/v1/x');
  });

  it('never emits a known secret from a log payload (schema has no sensitive fields)', () => {
    const rec = captureStdout(() =>
      new JsonLogger().log('some operation completed'),
    );
    expect(rec).not.toHaveProperty('Authorization');
    expect(rec).not.toHaveProperty('password');
    expect(rec).not.toHaveProperty('accessToken');
    expect(rec).not.toHaveProperty('refreshToken');
    expect(rec).not.toHaveProperty('cookie');
  });
});
