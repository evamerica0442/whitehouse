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

/**
 * Extracts something useful from an unknown thrown value.
 *
 * This is not defensive padding — it is required. A failed Neon connection does not
 * throw an `Error`: the serverless driver dispatches an **`ErrorEvent`** over its
 * WebSocket, whose `message` is `""` and whose only enumerable property is
 * `clientVersion`. Reporting that verbatim ("error object with keys: clientVersion")
 * tells an operator nothing, so we walk the cause/error chain instead:
 *
 *     ErrorEvent → TypeError (no message)
 */
export function describeError(error: unknown): string {
  const descriptors: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);

    if (typeof current === 'string') {
      descriptors.push(current);
      break;
    }

    if (current instanceof Error) {
      descriptors.push(current.message ? `${current.name}: ${current.message}` : `${current.name} (no message)`);
      current = current.cause;
      continue;
    }

    if (isEventLike(current)) {
      descriptors.push(current.type || 'event');
      current = current.error;
      continue;
    }

    if (typeof current === 'object') {
      const candidate = current as {
        code?: unknown;
        errno?: unknown;
        message?: unknown;
        cause?: unknown;
        error?: unknown;
        errors?: unknown;
      };

      const bits = [candidate.code, candidate.errno, candidate.message].filter(
        (part): part is string | number => typeof part === 'string' || typeof part === 'number',
      );

      if (bits.length > 0) {
        descriptors.push(bits.map(String).join(' '));
        current = candidate.cause ?? candidate.error ?? firstOf(candidate.errors);
        continue;
      }

      const keys = Object.keys(current);
      descriptors.push(keys.length > 0 ? `object(${keys.join(', ')})` : 'empty object');
      current = candidate.cause ?? candidate.error ?? firstOf(candidate.errors);
      continue;
    }

    descriptors.push(String(current));
    break;
  }

  return descriptors.length > 0 ? descriptors.join(' -> ') : 'unrecognised error (see server logs)';
}

function firstOf(value: unknown): unknown {
  return Array.isArray(value) && value.length > 0 ? value[0] : undefined;
}

/** DOM/CustomEvent-shaped values (what the Neon driver throws) are not `Error`s. */
function isEventLike(value: unknown): value is { type?: string; error?: unknown } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; error?: unknown; defaultPrevented?: unknown };
  return (
    typeof candidate.type === 'string' &&
    ('error' in candidate || typeof candidate.defaultPrevented === 'boolean')
  );
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
