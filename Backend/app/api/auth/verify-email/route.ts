// api/auth/verify-email/route.ts

import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/enterprise/core/api-response';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token || token.length !== 64) return fail('INVALID_TOKEN', 'Invalid verification token', 400);

  const hashed = createHash('sha256').update(token).digest('hex');

  try {
    const users = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM users
      WHERE "emailVerifyToken" = ${hashed}
        AND "emailVerifyExpiry" > NOW()
        AND "emailVerified" IS NULL
      LIMIT 1
    `;

    if (!users.length) return fail('INVALID_TOKEN', 'Verification link is invalid or expired', 400);

    await prisma.$executeRaw`
      UPDATE users SET
        "emailVerified" = NOW(),
        "emailVerifyToken" = NULL,
        "emailVerifyExpiry" = NULL
      WHERE id = ${users[0].id}
    `;

    // Redirect to frontend with success
    const frontendUrl = process.env.FRONTEND_URL || 'https://melody-ai.netlify.app';
    return Response.redirect(`${frontendUrl}/login?verified=1`, 302);
  } catch (err) {
    console.error('[verify-email] error:', err);
    return fail('INTERNAL_ERROR', 'Verification failed', 500);
  }
}
