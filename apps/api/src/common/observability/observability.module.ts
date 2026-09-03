import { Global, Module, NestModule, MiddlewareConsumer } from '@nestjs/common';

import { RequestContextMiddleware } from './request-context.middleware';

/**
 * Structured observability (HIGH #7): JSON logging + per-request correlation id propagation.
 * The middleware is applied to every route and runs before controllers/guards, so auth and
 * authorization handlers also produce structured, correlation-tagged logs.
 */
@Global()
@Module({})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
