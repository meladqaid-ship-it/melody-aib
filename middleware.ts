// middleware.ts — Global Middleware (Production-Grade)
// Handles: CORS, Auth Guard, Security Headers, Rate Limiting
// Replaces the two conflicting middleware files that were both active.

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// ─── Config ─────────────────────────────────────────────────────────────────

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-only-secret-change-in-production-min-32-chars!!'
);

// Read at startup so env issues surface immediately in logs
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://melody-ai.netlify.app';

const ALLOWED_ORIGINS = new Set([
  FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:3001',
]);

// ─── Route Classification ────────────────────────────────────────────────────

/** No JWT required — publicly accessible */
const PUBLIC_API_PREFIXES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/google',
  '/api/auth/forgot-password',
  '/api/auth/refresh',
  '/api/health',
  '/api/system/health',
];

/** Stripe/LemonSqueezy webhooks — verified by provider signature, not JWT */
const WEBHOOK_PREFIXES = [
  '/api/webhooks/',
];

/** Only ADMIN / SUPER_ADMIN may access */
const ADMIN_PREFIXES = [
  '/admin',
  '/api/admin',
];

// ─── In-Memory Rate Limiter (fallback when Redis unavailable) ────────────────

const rateLimitStore = new Map<string, { count: number; reset: number }>();

function inMemoryRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.reset) {
    rateLimitStore.set(key, { count: 1, reset: now + windowMs });
    return true; // allowed
  }
  if (entry.count >= max) return false; // blocked
  entry.count++;
  return true; // allowed
}

// Clean up every 10 min so the map doesn't grow unbounded
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitStore) {
    if (now > v.reset) rateLimitStore.delete(k);
  }
}, 10 * 60 * 1000);

// ─── CORS ────────────────────────────────────────────────────────────────────

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : FRONTEND_URL;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Organization-Id',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

// ─── Security Headers ────────────────────────────────────────────────────────

function applySecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-XSS-Protection', '1; mode=block');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  return res;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function json(body: object, status: number, corsHeaders: Record<string, string>): NextResponse {
  const res = NextResponse.json(body, { status });
  Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
  return applySecurityHeaders(res);
}

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
}

function isWebhook(pathname: string): boolean {
  return WEBHOOK_PREFIXES.some((p) => pathname.startsWith(p));
}

function isAdminRoute(pathname: string): boolean {
  return ADMIN_PREFIXES.some((p) => pathname.startsWith(p));
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get('origin');
  const cors = getCorsHeaders(origin);

  // 1. CORS preflight — respond immediately
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  // 2. Static assets — skip all checks
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    /\.(ico|png|jpg|jpeg|svg|webp|woff2?|css|js|map)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // 3. Webhooks — pass through (signature verification is inside each handler)
  if (isWebhook(pathname)) {
    const res = NextResponse.next();
    Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
    return applySecurityHeaders(res);
  }

  // 4. Public API routes — add CORS headers and pass through
  if (isPublicApi(pathname)) {
    const res = NextResponse.next();
    Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
    return applySecurityHeaders(res);
  }

  // 5. Non-API pages — public (login, register, landing…)
  if (!pathname.startsWith('/api')) {
    // These specific pages need no auth
    const publicPages = ['/', '/login', '/register', '/forgot-password', '/pricing', '/features'];
    if (publicPages.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
      return applySecurityHeaders(NextResponse.next());
    }
  }

  // 6. JWT Authentication for everything else
  const authToken =
    req.cookies.get('auth-token')?.value ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (!authToken) {
    if (pathname.startsWith('/api')) {
      return json({ success: false, error: 'Unauthorized' }, 401, cors);
    }
    // Redirect browser navigation to login
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  let jwtPayload: { userId?: unknown; email?: unknown; role?: unknown } = {};
  try {
    const { payload } = await jwtVerify(authToken, JWT_SECRET, { algorithms: ['HS256'] });
    jwtPayload = payload as typeof jwtPayload;
  } catch {
    if (pathname.startsWith('/api')) {
      return json({ success: false, error: 'Token expired or invalid' }, 401, cors);
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 7. Admin role check
  if (isAdminRoute(pathname)) {
    const role = String(jwtPayload.role || '');
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      if (pathname.startsWith('/api')) {
        return json({ success: false, error: 'Forbidden' }, 403, cors);
      }
      return NextResponse.redirect(new URL('/', req.url));
    }
  }

  // 8. Rate limiting for auth-sensitive endpoints (in-memory fallback)
  if (pathname.startsWith('/api/auth')) {
    const ip =
      req.headers.get('x-real-ip') ||
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      'unknown';
    const key = `rl:auth:${ip}`;
    const allowed = inMemoryRateLimit(key, 20, 60_000); // 20 req/min
    if (!allowed) {
      return json({ success: false, error: 'Too many requests' }, 429, cors);
    }
  }

  // 9. Forward verified user info to downstream handlers
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-user-id', String(jwtPayload.userId || ''));
  requestHeaders.set('x-user-email', String(jwtPayload.email || ''));
  requestHeaders.set('x-user-role', String(jwtPayload.role || ''));

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  // Attach CORS + security headers to every response
  Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
  return applySecurityHeaders(res);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
