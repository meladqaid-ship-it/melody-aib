// enterprise/core/api-response.ts — Centralized API Response (Production)
// All API routes MUST use these helpers to ensure consistent shape:
// Success: { success: true,  data: T,    error: null }
// Failure: { success: false, data: null, error: { code, message, details? } }

import { NextResponse } from 'next/server';
import { AppError } from './errors';

export type ApiSuccess<T> = {
  success: true;
  data: T;
  error: null;
  meta?: Record<string, unknown>;
};

export type ApiFailure = {
  success: false;
  data: null;
  error: { code: string; message: string; details?: unknown };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** 200 OK */
export function ok<T>(data: T, meta?: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json<ApiSuccess<T>>(
    { success: true, data, error: null, ...(meta ? { meta } : {}) },
    { status }
  );
}

/** 201 Created */
export function created<T>(data: T, meta?: Record<string, unknown>): NextResponse {
  return ok(data, meta, 201);
}

/** 4xx / 5xx error */
export function fail(
  code: string,
  message: string,
  status = 400,
  details?: unknown
): NextResponse {
  return NextResponse.json<ApiFailure>(
    { success: false, data: null, error: { code, message, ...(details ? { details } : {}) } },
    { status }
  );
}

/** Convert AppError to response */
export function fromError(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return fail(err.code, err.message, err.status, err.details);
  }
  console.error('[api] Unhandled error:', err);
  return fail('INTERNAL_ERROR', 'Internal server error', 500);
}

/** Paginated response wrapper */
export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): NextResponse {
  return ok(data, { total, page, limit, pages: Math.ceil(total / limit) });
}
