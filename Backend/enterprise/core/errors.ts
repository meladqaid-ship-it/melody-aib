// enterprise/core/errors.ts — Domain Error Classes

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: () => new AppError('UNAUTHORIZED', 'Unauthorized', 401),
  forbidden: () => new AppError('FORBIDDEN', 'Forbidden', 403),
  notFound: (name = 'Resource') => new AppError('NOT_FOUND', `${name} not found`, 404),
  conflict: (msg = 'Resource already exists') => new AppError('CONFLICT', msg, 409),
  insufficientCredits: () =>
    new AppError('INSUFFICIENT_CREDITS', 'Insufficient credits. Please upgrade or buy more credits.', 402),
  validation: (details?: unknown) =>
    new AppError('VALIDATION_ERROR', 'Validation failed', 400, details),
  rateLimited: () => new AppError('RATE_LIMITED', 'Too many requests', 429),
  internal: (msg = 'Internal server error') => new AppError('INTERNAL_ERROR', msg, 500),
} as const;
