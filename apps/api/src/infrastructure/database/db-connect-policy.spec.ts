import { describe, expect, it } from 'vitest';

import { DB_CONNECT_DEFAULTS, delayForAttempt, parseDbConnectPolicy } from './db-connect-policy';

describe('delayForAttempt', () => {
  it('returns 0 for non-positive attempts', () => {
    expect(delayForAttempt(0, DB_CONNECT_DEFAULTS)).toBe(0);
    expect(delayForAttempt(-1, DB_CONNECT_DEFAULTS)).toBe(0);
  });

  it('exponentially backs off from the initial delay', () => {
    const policy = { maxRetries: 10, initialDelayMs: 500, maxDelayMs: 30000 };
    expect(delayForAttempt(1, policy)).toBe(500);
    expect(delayForAttempt(2, policy)).toBe(1000);
    expect(delayForAttempt(3, policy)).toBe(2000);
    expect(delayForAttempt(4, policy)).toBe(4000);
  });

  it('caps the delay at maxDelayMs', () => {
    const policy = { maxRetries: 10, initialDelayMs: 500, maxDelayMs: 30000 };
    // attempt 7 would naturally be 32s, so it is capped at maxDelayMs
    expect(delayForAttempt(7, policy)).toBe(30000);
    expect(delayForAttempt(20, policy)).toBe(30000);
  });
});

describe('parseDbConnectPolicy', () => {
  it('uses defaults when unset', () => {
    expect(parseDbConnectPolicy({})).toEqual(DB_CONNECT_DEFAULTS);
  });

  it('reads provided values', () => {
    const policy = parseDbConnectPolicy({
      DB_CONNECT_MAX_RETRIES: '5',
      DB_CONNECT_INITIAL_DELAY_MS: '1000',
      DB_CONNECT_MAX_DELAY_MS: '20000',
    });
    expect(policy).toEqual({ maxRetries: 5, initialDelayMs: 1000, maxDelayMs: 20000 });
  });

  it('clamps out-of-range or non-numeric values to bounded safe defaults', () => {
    // maxRetries capped at 60
    expect(parseDbConnectPolicy({ DB_CONNECT_MAX_RETRIES: '999999' }).maxRetries).toBe(60);
    // negative/zero/NaN -> default
    expect(parseDbConnectPolicy({ DB_CONNECT_MAX_RETRIES: '-3' }).maxRetries).toBe(
      DB_CONNECT_DEFAULTS.maxRetries,
    );
    expect(parseDbConnectPolicy({ DB_CONNECT_INITIAL_DELAY_MS: '0' }).initialDelayMs).toBe(
      DB_CONNECT_DEFAULTS.initialDelayMs,
    );
    expect(parseDbConnectPolicy({ DB_CONNECT_MAX_DELAY_MS: 'abc' }).maxDelayMs).toBe(
      DB_CONNECT_DEFAULTS.maxDelayMs,
    );
  });
});
