// api/auth/refresh/route.ts — Fixed
// Supports: cookie-based AND Authorization: Bearer <refreshToken>
// Returns: new accessToken in body + sets new HttpOnly cookies

import { NextRequest } from 'next/server';
import { AuthService } from '@/lib/auth';
import { ok, fail } from '@/enterprise/core/api-response';

export async function POST(req: NextRequest) {
  try {
    // Accept refresh token from cookie (preferred) or Authorization header
    const refreshToken =
      req.cookies.get('refresh-token')?.value ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

    if (!refreshToken) {
      return fail('NO_REFRESH_TOKEN', 'Refresh token not found', 401);
    }

    const tokens = await AuthService.refreshAccessToken(refreshToken);

    // Rotate both cookies
    AuthService.setAuthCookie('auth-token', tokens.accessToken, 15 * 60);
    AuthService.setAuthCookie('refresh-token', tokens.refreshToken, 7 * 24 * 60 * 60);

    return ok({ accessToken: tokens.accessToken, message: 'Tokens refreshed successfully' });
  } catch (error) {
    // Clear invalid/expired tokens
    AuthService.clearAuthCookie('auth-token');
    AuthService.clearAuthCookie('refresh-token');
    return fail('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token', 401);
  }
}
