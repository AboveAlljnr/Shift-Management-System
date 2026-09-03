import type {
  ExceptionFilter,
  ArgumentsHost} from '@nestjs/common';
import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    // Client errors (4xx) may carry a meaningful, client-safe message from the controller
    // (e.g. validation/authorization). 5xx are unexpected internal failures: never echo the
    // underlying error message/stack to the client, since it can leak internal paths,
    // connection details, or implementation internals (security.md: error leakage).
    const isClientError = status < 500;

    const message =
      isClientError &&
      exception instanceof HttpException &&
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null
        ? (exceptionResponse as Record<string, unknown>)['message'] ?? exception.message
        : 'Internal server error';

    const errors =
      isClientError &&
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null
        ? (exceptionResponse as Record<string, unknown>)['errors']
        : undefined;

    if (status >= 500) {
      // Full detail goes to the server logs only, never to the client response body. Use the
      // route template (not the raw URL) to avoid logging query-string PII; the structured
      // logger attaches the request correlation id automatically.
      this.logger.error(
        `${request.method} ${request.route?.path ?? request.path}`,
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
