// api/auth/register/route.ts — Fixed + Email Verification

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { randomBytes, createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { rateLimit } from '@/middleware/rate-limit';
import { ok, fail, created } from '@/enterprise/core/api-response';
import { sendVerificationEmail, sendWelcomeEmail } from '@/lib/email';

const registerSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
  name: z.string().min(1).max(100).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req, { max: 5, window: 60 });
    if (!rl.success) return fail('RATE_LIMITED', 'Too many requests. Please try again later.', 429);

    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', 'Invalid registration data', 400, parsed.error.errors);
    }

    const { email, password, name } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return fail('EMAIL_EXISTS', 'An account with this email already exists', 409);

    const hashedPassword = await AuthService.hashPassword(password);

    // Generate email verification token (hashed in DB, raw sent in email)
    const verifyToken = randomBytes(32).toString('hex');
    const hashedToken = createHash('sha256').update(verifyToken).digest('hex');
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || 'User',
        credits: 100,
      },
      select: {
        id: true, email: true, name: true,
        avatar: true, role: true, tier: true,
        credits: true, totalSongsGenerated: true,
      },
    });

    // Store verification token via raw SQL (columns may not be in Prisma model yet)
    await prisma.$executeRaw`
      UPDATE users SET
        "emailVerifyToken" = ${hashedToken},
        "emailVerifyExpiry" = ${tokenExpiry}::timestamp
      WHERE id = ${user.id}
    `.catch(() => {
      // Columns may not exist yet — non-fatal, email verification skipped
      console.warn('[register] email verification columns not found in schema');
    });

    const tokens = await AuthService.generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    AuthService.setAuthCookie('auth-token', tokens.accessToken, 15 * 60);
    AuthService.setAuthCookie('refresh-token', tokens.refreshToken, 7 * 24 * 60 * 60);

    // Send emails (fire-and-forget — don't block response)
    sendVerificationEmail(user.email, verifyToken).catch((e) =>
      console.error('[register] verification email failed:', e.message)
    );

    sendWelcomeEmail(user.email, user.name || 'User').catch((e) =>
      console.error('[register] welcome email failed:', e.message)
    );

    prisma.auditLog.create({
      data: {
        userId: user.id, action: 'REGISTER', entity: 'User', entityId: user.id,
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
      },
    }).catch(() => {});

    return created({ accessToken: tokens.accessToken, user });
  } catch (error) {
    console.error('[auth/register] error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}
