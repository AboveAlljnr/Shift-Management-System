import { z } from 'zod';

const postgresUrl = z
  .string()
  .min(1, 'DATABASE_URL is required')
  .refine(
    (v) => v.startsWith('postgres://') || v.startsWith('postgresql://'),
    { message: 'DATABASE_URL must be a postgres:// or postgresql:// URL' },
  );

const redisUrl = z
  .string()
  .min(1, 'REDIS_URL is required')
  .startsWith('redis://', { message: 'REDIS_URL must be a redis:// URL' });

// Committed development values that must never be used in a production/staging environment.
const DEV_ACCESS_SECRET = 'sms-super-secret-jwt-access-key-for-dev-environment-12345';
const DEV_JWT_FALLBACK = 'sms-super-secret-jwt-key-for-dev-environment-12345';
const DEV_REFRESH_SECRET = 'sms-super-secret-jwt-refresh-key-for-dev-environment-67890';

/**
 * Shared fields, validated for every environment.
 *
 * `NODE_ENV` gates strictness. Required infrastructure wiring (DATABASE_URL, REDIS_URL) is
 * always enforced so the app fails fast instead of silently misconnecting.
 */
const common = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production', 'staging']).default('development'),
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl.default('redis://localhost:6379'),
  // CORS: comma-separated list of allowed browser origins. Empty list === deny all origins.
  ALLOWED_ORIGINS: z.string().default(''),
});

/**
 * Production / staging: secure, fail-fast configuration.
 *
 * JWT secrets are required, must be >= 16 chars, and must NOT equal any committed development
 * default. CORS must be explicitly configured and never wildcard.
 */
const prod = common.extend({
  APP_PORT: z.coerce.number().int().min(1).max(65535),
  JWT_ACCESS_SECRET: z
    .string()
    .min(16, 'JWT_ACCESS_SECRET must be at least 16 characters')
    .refine(
      (v) => v !== DEV_ACCESS_SECRET && v !== DEV_JWT_FALLBACK,
      'JWT_ACCESS_SECRET must not use a committed development default',
    ),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(16, 'JWT_REFRESH_SECRET must be at least 16 characters')
    .refine(
      (v) => v !== DEV_REFRESH_SECRET,
      'JWT_REFRESH_SECRET must not use a committed development default',
    ),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('7d'),
  ALLOWED_ORIGINS: z
    .string()
    .min(1, 'ALLOWED_ORIGINS must be explicitly configured in production')
    .refine(
      (v) => !v.split(',').some((o) => o.trim() === '*'),
      'ALLOWED_ORIGINS must not contain a wildcard "*" in production',
    ),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
});

/**
 * Development / test: frictionless but still validated.
 */
const dev = common.extend({
  JWT_ACCESS_SECRET: z.string().min(8).default(DEV_ACCESS_SECRET),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
  JWT_REFRESH_SECRET: z.string().min(8).default(DEV_REFRESH_SECRET),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('7d'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
});

/**
 * ConfigModule.validate callback. Parses and returns the validated environment. Throws a
 * ZodError (or plain Error) on invalid/insecure config so the API refuses to boot rather than
 * running with a broken or weak environment.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const env = (config.NODE_ENV as string | undefined) ?? 'development';
  if (env === 'production' || env === 'staging') {
    return prod.parse(config);
  }
  return dev.parse(config);
}
