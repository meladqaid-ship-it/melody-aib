// api/auth/login/route.ts — Fixed
// Changes: unified ApiResponse format { success, data, error }
// CORS is handled globally by middleware (removed duplicate inline CORS)
// rateLimit import uses updated path (no @upstash dependency)

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { rateLimit } from '@/middleware/rate-limit';
import { ok, fail } from '@/enterprise/core/api-response';

const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    // Rate-limit: 10 attempts / 60s per IP
    const rl = await rateLimit(req, { max: 10, window: 60 });
    if (!rl.success) {
      return fail('RATE_LIMITED', 'Too many login attempts. Please try again later.', 429);
    }

    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', 'Invalid email or password format', 400);
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.password) {
      return fail('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    if (!user.isActive) {
      return fail('ACCOUNT_DISABLED', 'Account is deactivated. Please contact support.', 403);
    }

    const isValid = await AuthService.comparePassword(password, user.password);

    if (!isValid) {
      // Fire-and-forget audit log — don't block the response
      prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'LOGIN_FAILED',
          entity: 'User',
          entityId: user.id,
          ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
        },
      }).catch(() => {});

      return fail('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    const tokens = await AuthService.generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Set HttpOnly cookies
    AuthService.setAuthCookie('auth-token', tokens.accessToken, 15 * 60);
    AuthService.setAuthCookie('refresh-token', tokens.refreshToken, 7 * 24 * 60 * 60);

    // Fire-and-forget side effects
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});
    prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN_SUCCESS',
        entity: 'User',
        entityId: user.id,
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
        userAgent: req.headers.get('user-agent') || 'unknown',
      },
    }).catch(() => {});

    return ok({
      accessToken: tokens.accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        role: user.role,
        tier: user.tier,
        credits: user.credits,
        totalSongsGenerated: user.totalSongsGenerated,
      },
    });
  } catch (error) {
    console.error('[auth/login] error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}
