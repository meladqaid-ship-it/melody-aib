// api/auth/google/route.ts — Google OAuth (Fixed)
// GET: OAuth redirect callback (browser flow)
// POST: ID token verification (mobile/SPA flow)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthService } from '@/lib/auth';
import { ok, fail } from '@/enterprise/core/api-response';
import { sendWelcomeEmail } from '@/lib/email';

const BACKEND_URL = process.env.NEXTAUTH_URL || process.env.RENDER_EXTERNAL_URL || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://melody-ai.netlify.app';

async function findOrCreateGoogleUser(googleUser: {
  id: string; sub?: string; email: string; name: string; picture?: string;
}) {
  const googleId = googleUser.id || googleUser.sub || '';
  const isNew = { value: false };

  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId }, { email: googleUser.email }] },
  });

  if (user) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        googleId,
        avatar: user.avatar || googleUser.picture,
        emailVerified: user.emailVerified || new Date(),
        name: user.name || googleUser.name,
        lastLoginAt: new Date(),
      },
    });
  } else {
    isNew.value = true;
    user = await prisma.user.create({
      data: {
        email: googleUser.email,
        name: googleUser.name,
        avatar: googleUser.picture,
        googleId,
        emailVerified: new Date(),
        credits: 100,
        lastLoginAt: new Date(),
      },
    });
    sendWelcomeEmail(user.email, user.name || 'User').catch(() => {});
  }

  return { user, isNew: isNew.value };
}

// GET — browser OAuth callback redirect
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code) return NextResponse.redirect(new URL(`${FRONTEND_URL}/login?error=no_code`));

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: `${BACKEND_URL}/api/auth/google`,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const { access_token } = await tokenRes.json();

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!userRes.ok) throw new Error('User info failed');
    const googleUser = await userRes.json();

    const { user } = await findOrCreateGoogleUser(googleUser);
    const tokens = await AuthService.generateTokens({ userId: user.id, email: user.email, role: user.role });

    AuthService.setAuthCookie('auth-token', tokens.accessToken, 15 * 60);
    AuthService.setAuthCookie('refresh-token', tokens.refreshToken, 7 * 24 * 60 * 60);

    prisma.auditLog.create({
      data: { userId: user.id, action: 'GOOGLE_LOGIN', entity: 'User', entityId: user.id,
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown' },
    }).catch(() => {});

    const redirect = state ? decodeURIComponent(state) : `${FRONTEND_URL}/dashboard`;
    return NextResponse.redirect(redirect);
  } catch (err) {
    console.error('[google/GET] OAuth error:', err);
    return NextResponse.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
  }
}

// POST — ID token flow (mobile / one-tap)
export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json();
    if (!idToken) return fail('MISSING_TOKEN', 'ID token is required', 400);

    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
    if (!verifyRes.ok) return fail('INVALID_TOKEN', 'Invalid Google ID token', 401);

    const googleUser = await verifyRes.json();
    if (googleUser.aud !== process.env.GOOGLE_CLIENT_ID) {
      return fail('TOKEN_AUDIENCE_MISMATCH', 'Token audience mismatch', 401);
    }

    const { user } = await findOrCreateGoogleUser({
      id: googleUser.sub, email: googleUser.email,
      name: googleUser.name, picture: googleUser.picture,
    });

    const tokens = await AuthService.generateTokens({ userId: user.id, email: user.email, role: user.role });
    AuthService.setAuthCookie('auth-token', tokens.accessToken, 15 * 60);
    AuthService.setAuthCookie('refresh-token', tokens.refreshToken, 7 * 24 * 60 * 60);

    return ok({
      accessToken: tokens.accessToken,
      user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar, role: user.role, tier: user.tier, credits: user.credits },
    });
  } catch (err) {
    console.error('[google/POST] error:', err);
    return fail('INTERNAL_ERROR', 'Authentication failed', 500);
  }
}
