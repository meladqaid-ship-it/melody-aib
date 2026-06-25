// api/auth/logout/route.ts — New (was missing)

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { ok } from '@/enterprise/core/api-response';

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get('refresh-token')?.value;

  if (refreshToken) {
    // Invalidate session in DB
    await prisma.session.deleteMany({ where: { token: refreshToken } }).catch(() => {});
  }

  AuthService.clearAuthCookie('auth-token');
  AuthService.clearAuthCookie('refresh-token');

  return ok({ message: 'Logged out successfully' });
}
