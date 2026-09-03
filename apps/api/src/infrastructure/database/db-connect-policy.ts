export interface DbConnectPolicy {
  /** Maximum number of connection attempts (including the first). */
  maxRetries: number;
  /** Delay for the first retry, in ms. */
  initialDelayMs: number;
  /** Upper bound on any single retry delay, in ms. */
  maxDelayMs: number;
}

export const DB_CONNECT_DEFAULTS: DbConnectPolicy = {
  maxRetries: 10,
  initialDelayMs: 500,
  maxDelayMs: 30000,
};

/**
 * Deterministic exponential backoff with a cap. `attempt` is 1-based (the first retry is
 * attempt 1). Returns the sleep delay before that retry in ms.
 */
export function delayForAttempt(attempt: number, policy: DbConnectPolicy): number {
  if (attempt <= 0) return 0;
  const exponent = Math.pow(2, attempt - 1);
  return Math.min(policy.initialDelayMs * exponent, policy.maxDelayMs);
}

function toPositiveInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(Math.min(n, max));
}

/**
 * Build a validated policy from raw environment values, clamping to sane bound so a typo cannot
 * cause an infinite/hostile retry loop. Falls back to DB_CONNECT_DEFAULTS.
 */
export function parseDbConnectPolicy(env: {
  DB_CONNECT_MAX_RETRIES?: unknown;
  DB_CONNECT_INITIAL_DELAY_MS?: unknown;
  DB_CONNECT_MAX_DELAY_MS?: unknown;
}): DbConnectPolicy {
  return {
    maxRetries: toPositiveInt(env.DB_CONNECT_MAX_RETRIES, DB_CONNECT_DEFAULTS.maxRetries, 60),
    initialDelayMs: toPositiveInt(env.DB_CONNECT_INITIAL_DELAY_MS, DB_CONNECT_DEFAULTS.initialDelayMs, 60_000),
    maxDelayMs: toPositiveInt(env.DB_CONNECT_MAX_DELAY_MS, DB_CONNECT_DEFAULTS.maxDelayMs, 300_000),
  };
}
