import { AsyncLocalStorage } from 'node:async_hooks';

export interface TraceContext {
  correlationId: string;
  method: string;
  path: string;
}

/**
 * AsyncLocalStorage used to propagate the current request's trace context (correlation id,
 * method, route) through the whole async call chain within a single request. This lets any
 * logger call attach the correlation id even from deep service code, so all log lines for one
 * request can be traced together. Nothing sensitive is ever stored here.
 */
export const traceContext = new AsyncLocalStorage<TraceContext>();

export function getTrace(): TraceContext | undefined {
  return traceContext.getStore();
}

export function correlationId(): string {
  return getTrace()?.correlationId ?? '-';
}

export function runWithTrace<T>(ctx: TraceContext, fn: () => T): T {
  return traceContext.run(ctx, fn);
}
