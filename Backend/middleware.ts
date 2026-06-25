import { NextRequest, NextResponse } from 'next/server';

// ======================
// 🌍 Allowed Origins
// ======================
const allowedOrigins = [
  'https://melody-ai.netlify.app',
  'http://localhost:3000',
];

// ======================
// 🌐 CORS FUNCTION
// ======================
function getCorsHeaders(origin: string | null) {
  const allowOrigin =
    origin && allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

// ======================
// 🚀 MAIN MIDDLEWARE
// ======================
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get('origin');

  // ----------------------
  // 1. Handle CORS Preflight
  // ----------------------
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: getCorsHeaders(origin),
    });
  }

  // ----------------------
  // 2. Protect API Routes (optional auth guard)
  // ----------------------
  const protectedRoutes = [
    '/api/projects',
    '/api/ai',
    '/api/credits',
    '/api/user',
  ];

  const isProtected = protectedRoutes.some((route) =>
    pathname.startsWith(route)
  );

  if (isProtected) {
    const token =
      req.cookies.get('auth-token')?.value ||
      req.headers.get('authorization')?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        {
          status: 401,
          headers: getCorsHeaders(origin),
        }
      );
    }
  }

  // ----------------------
  // 3. Normal request pass-through
  // ----------------------
  const response = NextResponse.next();

  // Attach CORS headers to every response
  Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

// ======================
// 🔥 Middleware matcher
// ======================
export const config = {
  matcher: [
    '/api/:path*', // apply only to API routes
  ],
};
