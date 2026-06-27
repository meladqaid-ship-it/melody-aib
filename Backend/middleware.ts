import { NextRequest, NextResponse } from 'next/server';

// ======================
// 🌍 Allowed Origins
// ======================
const allowedOrigins = [
  'https://melody-ai.netlify.app',
  'https://melody-ai-g35z.onrender.com',
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
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
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

  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: getCorsHeaders(origin),
    });
  }

  const protectedRoutes = [
    '/api/projects',
    '/api/ai',
    '/api/studio',
    '/api/songs',
    '/api/credits',
    '/api/user',
    '/api/admin',
    '/api/billing',
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
        { success: false, error: 'Unauthorized' },
        {
          status: 401,
          headers: getCorsHeaders(origin),
        }
      );
    }
  }

  const response = NextResponse.next();

  Object.entries(getCorsHeaders(origin)).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
