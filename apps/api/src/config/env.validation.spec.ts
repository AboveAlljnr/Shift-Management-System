import { describe, it, expect } from 'vitest';

import { validateEnv } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://sms:secret@localhost:5434/sms_dev',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateEnv', () => {
  describe('development / test', () => {
    it('accepts a minimal dev environment and applies defaults', () => {
      const out = validateEnv({ NODE_ENV: 'development', DATABASE_URL: base.DATABASE_URL, REDIS_URL: base.REDIS_URL });
      expect(out.APP_PORT).toBe(3001);
      expect(out.JWT_ACCESS_SECRET).toBeDefined();
      expect(out.ALLOWED_ORIGINS).toBe('');
    });

    it('rejects a missing or malformed DATABASE_URL', () => {
      expect(() => validateEnv({ NODE_ENV: 'test', DATABASE_URL: 'foo', REDIS_URL: base.REDIS_URL })).toThrow();
      expect(() => validateEnv({ NODE_ENV: 'test', REDIS_URL: base.REDIS_URL })).toThrow();
    });
  });

  describe('production / staging', () => {
    const goodProd = {
      NODE_ENV: 'production',
      APP_PORT: '3001',
      DATABASE_URL: base.DATABASE_URL,
      REDIS_URL: base.REDIS_URL,
      JWT_ACCESS_SECRET: 'A'.repeat(24),
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_SECRET: 'B'.repeat(24),
      JWT_REFRESH_EXPIRES_IN: '7d',
      ALLOWED_ORIGINS: 'https://app.example.com',
    };

    it('accepts strong secrets and explicit non-wildcard origins', () => {
      const out = validateEnv(goodProd);
      expect(out.APP_PORT).toBe(3001);
      expect(out.ALLOWED_ORIGINS).toBe('https://app.example.com');
    });

    it('fails fast when JWT_ACCESS_SECRET is a committed dev default', () => {
      expect(() => validateEnv({ ...goodProd, JWT_ACCESS_SECRET: 'sms-super-secret-jwt-key-for-dev-environment-12345' })).toThrow(/must not use a committed development default/);
    });

    it('fails fast when JWT_ACCESS_SECRET is too short', () => {
      expect(() => validateEnv({ ...goodProd, JWT_ACCESS_SECRET: 'short' })).toThrow(/at least 16/);
    });

    it('fails fast when CORS is unset in production', () => {
      expect(() => validateEnv({ ...goodProd, ALLOWED_ORIGINS: '' })).toThrow(/explicitly configured/);
    });

    it('fails fast when CORS uses a wildcard in production', () => {
      expect(() => validateEnv({ ...goodProd, ALLOWED_ORIGINS: 'https://a.example.com,*' })).toThrow(/must not contain a wildcard/);
    });

    it('fails fast when APP_PORT is missing in production', () => {
      expect(
        () =>
          validateEnv({
            NODE_ENV: 'production',
            DATABASE_URL: base.DATABASE_URL,
            REDIS_URL: base.REDIS_URL,
            JWT_ACCESS_SECRET: 'A'.repeat(24),
            JWT_REFRESH_SECRET: 'B'.repeat(24),
            ALLOWED_ORIGINS: 'https://app.example.com',
          }),
      ).toThrow();
    });
  });
});
