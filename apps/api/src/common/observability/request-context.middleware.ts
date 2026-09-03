import { randomUUID } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { runWithTrace } from './trace-context';

const CORRELATION_HEADER = 'x-request-id';

/**
 * Per-request structured observability (HIGH #7).
 *
 *  - Generates (or forwards) a correlation id in `x-request-id`, echoes it on the response so
 *    clients/orchestrators can trace, and stores it (plus method + route template) in
 *    AsyncLocalStorage so every structured log line for the request carries the correlation id.
 *  - On response completion, writes a single access line: method, route, status, durationMs,
 *    correlationId, env. The route template and req.path deliberately exclude the query string,
 *    and request bodies / Authorization headers are never read, so no secrets or PII leak here.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId =
      (req.get(CORRELATION_HEADER) as string | undefined)?.trim() || randomUUID();
    res.setHeader(CORRELATION_HEADER, correlationId);

    const startedAt = Date.now();
    const method = req.method;
    // Full request path minus the query string (avoids logging query-string PII and reflects the
    // real route including the global prefix). req.route may be unpopulated in middleware.
    const path = (req.originalUrl ?? req.baseUrl ?? req.path).split('?')[0] ?? '';

    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const record = {
        message: 'request complete',
        method,
        path,
        status: res.statusCode,
        durationMs,
        correlationId,
        env: process.env.NODE_ENV ?? 'development',
      };
      process.stdout.write(JSON.stringify(record) + '\n');
    });

    runWithTrace({ correlationId, method, path }, () => next());
  }
}
