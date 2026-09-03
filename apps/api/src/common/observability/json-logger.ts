import { LoggerService } from '@nestjs/common';

import { correlationId, getTrace } from './trace-context';

type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';

/**
 * Structured JSON logger (HIGH #7). Every line is a single JSON object on stdout/stderr with a
 * stable shape: { level, message, context, timestamp, env, correlationId, method, path }.
 * The per-request correlation id / method / path are attached (when inside a request) so all
 * logs for one request can be correlated. No secrets, tokens, cookies, Authorization headers,
 * or request bodies are ever logged.
 */
export class JsonLogger implements LoggerService {
  private readonly env = process.env.NODE_ENV ?? 'development';

  log(message: unknown, context?: string) {
    this.write('log', message, context);
  }

  error(message: unknown, stack?: unknown, context?: string) {
    this.write('error', message, context, stack);
  }

  warn(message: unknown, context?: string) {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string) {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string) {
    this.write('verbose', message, context);
  }

  fatal(message: unknown, context?: string) {
    this.write('fatal', message, context);
  }

  private write(level: LogLevel, message: unknown, context?: string, stack?: unknown) {
    const trace = getTrace();
    const record: Record<string, unknown> = {
      level,
      message: message instanceof Error ? message.message : message,
      timestamp: new Date().toISOString(),
      env: this.env,
      context: context ?? (message instanceof Error ? message.name : undefined),
      correlationId: correlationId(),
    };
    if (trace?.method) record.method = trace.method;
    if (trace?.path) record.path = trace.path;
    if (stack !== undefined) record.stack = stack instanceof Error ? stack.stack : stack;

    const line = JSON.stringify(record);
    // Reinject into the object for inspectability while avoiding duplicate writes.
    if (level === 'error' || level === 'fatal') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }
}

export const jsonLogger = new JsonLogger();
