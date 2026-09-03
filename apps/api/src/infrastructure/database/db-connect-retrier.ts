import type { Logger } from '@nestjs/common';

import type { DbConnectPolicy } from './db-connect-policy';
import { delayForAttempt } from './db-connect-policy';

export interface DbConnectRetrierOptions {
  policy: DbConnectPolicy;
  logger: Pick<Logger, 'log' | 'warn' | 'error'>;
  /** Optional predicate; when true the retry loop aborts promptly (e.g. shutdown signal). */
  shouldAbort?: () => boolean;
}

/**
 * Bounded, deterministic retry for establishing the startup database connection (HIGH #5).
 *
 * A transient Postgres outage during container boot caused an immediate crash-loop because
 * `$connect()` was unguarded. This retries with exponential backoff a bounded number of times,
 * logs each attempt, and then fails startup explicitly. Shutdown signals abort promptly. It does
 * not hide permanent configuration errors: invalid config is rejected by `validateEnv` before
 * this runs, and a non-transient connect error simply exhausts the budget and rethrows.
 */
export class DbConnectRetrier {
  private readonly policy: DbConnectPolicy;
  private readonly logger: Pick<Logger, 'log' | 'warn' | 'error'>;
  private readonly shouldAbort: () => boolean;

  constructor(options: DbConnectRetrierOptions) {
    this.policy = options.policy;
    this.logger = options.logger;
    this.shouldAbort = options.shouldAbort ?? (() => false);
  }

  /**
   * Runs `connect` up to `maxRetries` times (including the first). Resolves once connected,
   * otherwise throws after the budget is exhausted (or aborts early on a shutdown signal).
   */
  async connect(connect: () => Promise<void>): Promise<void> {
    let attempt = 1;
    for (;;) {
      try {
        await connect();
        if (attempt > 1) {
          this.logger.log(`Database connection established after ${attempt} attempts`);
        }
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt >= this.policy.maxRetries) {
          this.logger.error(
            `Database connection failed after ${this.policy.maxRetries} attempts; giving up`,
            message,
          );
          throw err;
        }
        if (this.shouldAbort()) {
          this.logger.warn('Database connection retry aborted by shutdown signal');
          throw err;
        }
        const delay = delayForAttempt(attempt, this.policy);
        this.logger.warn(
          `Database connection attempt ${attempt} failed (${message}); retrying in ${delay}ms`,
        );
        await this.sleep(delay);
        attempt += 1;
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.shouldAbort()) {
        resolve();
        return;
      }
      // Abort on a shutdown signal even during the longest backoff sleep, so SIGTERM is honoured.
      const abort = () => {
        clearInterval(interval);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(abort, ms);
      const interval = setInterval(() => {
        if (this.shouldAbort()) abort();
      }, 100);
    });
  }
}
