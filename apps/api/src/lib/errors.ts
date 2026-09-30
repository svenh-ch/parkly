import { ERROR_CODES, type ErrorCode } from '@parking/shared';

/** Fachlicher Fehler mit HTTP-Status. Nur diese Meldungen werden an Clients ausgeliefert. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static unauthenticated(message = 'Bitte melde dich an') {
    return new AppError(401, ERROR_CODES.UNAUTHENTICATED, message);
  }
  static forbidden(message = 'Keine Berechtigung für diese Aktion') {
    return new AppError(403, ERROR_CODES.FORBIDDEN, message);
  }
  static notFound(message = 'Nicht gefunden') {
    return new AppError(404, ERROR_CODES.NOT_FOUND, message);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError(409, ERROR_CODES.CONFLICT, message, details);
  }
  static validation(message: string, details?: unknown) {
    return new AppError(400, ERROR_CODES.VALIDATION_ERROR, message, details);
  }
}

/** PostgreSQL-Fehlercodes, die wir gezielt in fachliche Fehler übersetzen. */
export const PG_ERRORS = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
} as const;

export function pgErrorCode(err: unknown): string | undefined {
  // drizzle wrappt Treiberfehler; der Original-Fehler steckt in `cause`.
  let current: unknown = err;
  for (let i = 0; i < 3 && current && typeof current === 'object'; i++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function pgConstraint(err: unknown): string | undefined {
  let current: unknown = err;
  for (let i = 0; i < 3 && current && typeof current === 'object'; i++) {
    const constraint = (current as { constraint?: unknown }).constraint;
    if (typeof constraint === 'string') return constraint;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
