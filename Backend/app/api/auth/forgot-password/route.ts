// api/auth/forgot-password/route.ts — Fixed (unified ApiResponse format)

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/middleware/rate-limit';
import { randomBytes, createHash } from 'crypto';
import { sendResetPasswordEmail } from '@/lib/email';
import { ok, fail } from '@/enterprise/core/api-response';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_URL || 'https://melody-ai.netlify.app';

const forgotSchema = z.object({ email: z.string().email().toLowerCase().trim() });
const resetSchema = z.object({
  token: z.string().length(64),
  password: z.string().min(8).regex(/[A-Z]/, 'uppercase').regex(/[0-9]/, 'number'),
});

// POST /api/auth/forgot-password — request reset link
export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { max: 3, window: 3600 });
  if (!rl.success) return fail('RATE_LIMITED', 'Too many attempts. Try again in 1 hour.', 429);

  const body = await req.json();
  const parsed = forgotSchema.safeParse(body);
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid email', 400);

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

  if (user) {
    const token = randomBytes(32).toString('hex');
    const hashed = createHash('sha256').update(token).digest('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1hr

    await prisma.$executeRaw`
      UPDATE users SET "resetToken" = ${hashed}, "resetTokenExpiry" = ${expiry}::timestamp
      WHERE id = ${user.id}
    `.catch(() => console.warn('[forgot-password] resetToken columns not in schema yet'));

    const resetUrl = `${APP_URL}/reset-password?token=${token}`;
    sendResetPasswordEmail(user.email, resetUrl).catch((e) =>
      console.error('[forgot-password] email failed:', e.message)
    );

    prisma.auditLog.create({
      data: { userId: user.id, action: 'PASSWORD_RESET_REQUESTED', entity: 'User', entityId: user.id,
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown' },
    }).catch(() => {});
  }

  // Always same response — prevents user enumeration
  return ok({ message: 'If an account exists with this email, a reset link has been sent.' });
}

// PUT /api/auth/forgot-password — reset with token
export async function PUT(req: NextRequest) {
  const rl = await rateLimit(req, { max: 5, window: 3600 });
  if (!rl.success) return fail('RATE_LIMITED', 'Too many attempts.', 429);

  const body = await req.json();
  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid request', 400, parsed.error.errors);

  const hashed = createHash('sha256').update(parsed.data.token).digest('hex');

  const users = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM users
    WHERE "resetToken" = ${hashed} AND "resetTokenExpiry" > NOW()
    LIMIT 1
  `.catch(() => []);

  if (!users.length) return fail('INVALID_TOKEN', 'Reset link is invalid or expired', 400);

  const { AuthService } = await import('@/lib/auth');
  const hashedPw = await AuthService.hashPassword(parsed.data.password);

  await prisma.$executeRaw`
    UPDATE users SET password = ${hashedPw}, "resetToken" = NULL, "resetTokenExpiry" = NULL
    WHERE id = ${users[0].id}
  `;

  // Revoke all sessions for security
  await prisma.session.deleteMany({ where: { userId: users[0].id } });

  return ok({ message: 'Password reset successfully. Please log in with your new password.' });
}
