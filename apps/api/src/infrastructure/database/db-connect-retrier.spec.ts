import { describe, expect, it, vi } from 'vitest';

import type { DbConnectPolicy } from './db-connect-policy';
import { DbConnectRetrier } from './db-connect-retrier';

const policy: DbConnectPolicy = { maxRetries: 3, initialDelayMs: 5, maxDelayMs: 40000 };

function silentLogger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

describe('DbConnectRetrier', () => {
  it('connects immediately on success without extra attempts', async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const logger = silentLogger();
    await new DbConnectRetrier({ policy, logger }).connect(connect);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('recovers after a transient failure followed by success', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(undefined);
    const logger = silentLogger();
    await new DbConnectRetrier({ policy, logger }).connect(connect);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1); // one retry warning
    expect(logger.warn.mock.calls[0][0]).toContain('attempt 1 failed');
    expect(logger.warn.mock.calls[0][0]).toContain('retrying');
  });

  it('throws after the retry budget is exhausted', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('connection refused'));
    const logger = silentLogger();
    await expect(new DbConnectRetrier({ policy, logger }).connect(connect)).rejects.toThrow(
      'connection refused',
    );
    expect(connect).toHaveBeenCalledTimes(policy.maxRetries);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain('giving up');
  });

  it('aborts promptly on a shutdown signal', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('connection refused'));
    const logger = silentLogger();
    const shouldAbort = vi.fn().mockReturnValue(true);
    await expect(
      new DbConnectRetrier({ policy, logger, shouldAbort }).connect(connect),
    ).rejects.toThrow('connection refused');
    expect(connect).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls).toContainEqual(expect.arrayContaining(['Database connection retry aborted by shutdown signal']));
  });
});
