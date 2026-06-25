// api/auth/login/route.ts — Fixed cookies response

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { rateLimit } from '@/middleware/rate-limit';

const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

function jsonResponse(
  body: unknown,
  status = 200
) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req, { max: 10, window: 60 });

    if (!rl.success) {
      return jsonResponse(
        {
          success: false,
          data: null,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many login attempts. Please try again later.',
          },
        },
        429
      );
    }

    const body = await req.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return jsonResponse(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid email or password format',
          },
        },
        400
      );
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.password) {
      return jsonResponse(
        {
          success: false,
          data: null,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        },
        401
      );
    }

    if (!user.isActive) {
      return jsonResponse(
        {
          success: false,
          data: null,
          error: {
            code: 'ACCOUNT_DISABLED',
            message: 'Account is deactivated. Please contact support.',
          },
        },
        403
      );
    }

    const isValid = await AuthService.comparePassword(password, user.password);

    if (!isValid) {
      prisma.auditLog
        .create({
          data: {
            userId: user.id,
            action: 'LOGIN_FAILED',
            entity: 'User',
            entityId: user.id,
            ipAddress:
              req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
              'unknown',
          },
        })
        .catch(() => {});

      return jsonResponse(
        {
          success: false,
          data: null,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        },
        401
      );
    }

    const tokens = await AuthService.generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    prisma.user
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })
      .catch(() => {});

    prisma.auditLog
      .create({
        data: {
          userId: user.id,
          action: 'LOGIN_SUCCESS',
          entity: 'User',
          entityId: user.id,
          ipAddress:
            req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
            'unknown',
          userAgent: req.headers.get('user-agent') || 'unknown',
        },
      })
      .catch(() => {});

    const response = NextResponse.json(
      {
        success: true,
        data: {
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
        },
        error: null,
      },
      { status: 200 }
    );

    response.cookies.set('auth-token', tokens.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 15 * 60,
    });

    response.cookies.set('refresh-token', tokens.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (error) {
    console.error('[auth/login] error:', error);

    return jsonResponse(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      },
      500
    );
  }
}
