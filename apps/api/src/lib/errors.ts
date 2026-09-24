import { API_ERROR_CODES, HTTP_STATUS, type ApiErrorCode } from '@whitehouse/shared';

/**
 * Errors that are safe to show an admin. Anything else becomes a generic 500 so
 * internal details (SQL, ARNs, tokens) never leak into an HTTP response.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode | string;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(
    code: ApiErrorCode | string,
    message: string,
    statusCode: number = HTTP_STATUS.badRequest,
    options: { details?: unknown; expose?: boolean } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = options.details;
    this.expose = options.expose ?? true;
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError(API_ERROR_CODES.unauthorized, message, HTTP_STATUS.unauthorized);
  }

  static forbidden(message = 'Your role does not permit this action'): AppError {
    return new AppError(API_ERROR_CODES.forbidden, message, HTTP_STATUS.forbidden);
  }

  static notFound(resource: string): AppError {
    return new AppError(API_ERROR_CODES.notFound, `${resource} not found`, HTTP_STATUS.notFound);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError(API_ERROR_CODES.conflict, message, HTTP_STATUS.conflict, { details });
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError(API_ERROR_CODES.validationFailed, message, HTTP_STATUS.unprocessable, {
      details,
    });
  }

  static tenantNotReady(message: string): AppError {
    return new AppError(API_ERROR_CODES.tenantNotReady, message, HTTP_STATUS.conflict);
  }

  static internal(message = 'Unexpected server error'): AppError {
    return new AppError(API_ERROR_CODES.internalError, message, HTTP_STATUS.serverError, {
      expose: false,
    });
  }
}

/** Builds the single error envelope every route returns. */
export function toErrorResponse(error: unknown): {
  statusCode: number;
  body: { error: { code: string; message: string; details?: unknown } };
} {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.expose ? error.message : 'Unexpected server error',
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
    };
  }

  return {
    statusCode: HTTP_STATUS.serverError,
    body: {
      error: { code: API_ERROR_CODES.internalError, message: 'Unexpected server error' },
    },
  };
}
