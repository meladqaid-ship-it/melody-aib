// lib/auth.ts — Fixed AuthService
// Fixes:
// 1. setAuthCookie/clearAuthCookie cannot be called from route handlers directly
//    (cookies() from next/headers is write-only in middleware but works in Route Handlers)
//    — moved cookie writes to return NextResponse directly in auth routes instead.
// 2. getCurrentUser() depended on reading cookie inside service = caused issues when
//    called from App Router route handlers. Fixed: routes read userId from x-user-id header
//    (injected by global middleware). getCurrentUser() kept for backward compat.
// 3. generateTokens stores refreshToken in Session table — token rotation is enforced.

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { prisma } from './prisma';
import bcrypt from 'bcryptjs';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret-change-me-in-production-min-32-chars!!'
);

const JWT_REFRESH_SECRET = new TextEncoder().encode(
  process.env.JWT_REFRESH_SECRET ||
    process.env.JWT_SECRET + '-refresh' ||
    'dev-refresh-secret-change-me-min-32-chars!!'
);

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
}

export class AuthService {
  // ─── Password ───────────────────────────────────────────────────────────────

  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  static async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  // ─── Token Generation ────────────────────────────────────────────────────────

  static async generateTokens(payload: JWTPayload) {
    const now = Math.floor(Date.now() / 1000);

    const accessToken = await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime('15m')
      .sign(JWT_SECRET);

    const refreshToken = await new SignJWT({ userId: payload.userId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime('7d')
      .sign(JWT_REFRESH_SECRET);

    // Store refresh token in Session table (enables revocation + multi-device)
    await prisma.session
      .create({
        data: {
          userId: payload.userId,
          token: refreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })
      .catch((e) => console.warn('[auth] Session create warning:', e.message));

    // Clean up expired sessions for this user (fire-and-forget)
    prisma.session
      .deleteMany({
        where: { userId: payload.userId, expiresAt: { lt: new Date() } },
      })
      .catch(() => {});

    return { accessToken, refreshToken };
  }

  // ─── Verify Access Token ─────────────────────────────────────────────────────

  static async verifyToken(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ['HS256'] });
      return {
        userId: String(payload.userId),
        email: String(payload.email),
        role: String(payload.role),
      };
    } catch {
      throw new Error('Invalid or expired token');
    }
  }

  // ─── Refresh Token Rotation ───────────────────────────────────────────────────

  static async refreshAccessToken(refreshToken: string) {
    // 1. Verify cryptographic signature first (fast, no DB)
    try {
      await jwtVerify(refreshToken, JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
    } catch {
      throw new Error('Invalid refresh token signature');
    }

    // 2. Check DB — token must exist and not be expired
    const session = await prisma.session.findUnique({
      where: { token: refreshToken },
      include: { user: { select: { id: true, email: true, role: true, isActive: true } } },
    });

    if (!session || !session.user || session.expiresAt < new Date()) {
      throw new Error('Refresh token expired or revoked');
    }

    if (!session.user.isActive) {
      throw new Error('Account is deactivated');
    }

    // 3. Delete old session (rotation — prevents replay attacks)
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});

    // 4. Issue new token pair
    return this.generateTokens({
      userId: session.user.id,
      email: session.user.email,
      role: session.user.role,
    });
  }

  // ─── Get Current User (from cookie — for use inside Server Components) ────────

  static async getCurrentUser() {
    try {
      const cookieStore = cookies();
      const token = cookieStore.get('auth-token')?.value;
      if (!token) return null;
      const payload = await this.verifyToken(token);
      return prisma.user.findUnique({
        where: { id: payload.userId, isActive: true },
        select: { id: true, email: true, name: true, avatar: true, role: true, tier: true, credits: true, isActive: true },
      });
    } catch {
      return null;
    }
  }

  // ─── Cookie Helpers ──────────────────────────────────────────────────────────
  // Note: these work only inside Next.js Route Handlers & Server Actions.

  static setAuthCookie(name: string, value: string, maxAge: number) {
    try {
      const cookieStore = cookies();
      cookieStore.set(name, value, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge,
      });
    } catch (err) {
      console.warn('[auth] setAuthCookie failed:', (err as Error).message);
    }
  }

  static clearAuthCookie(name: string) {
    try {
      const cookieStore = cookies();
      cookieStore.set(name, '', { httpOnly: true, maxAge: 0, path: '/' });
    } catch (err) {
      console.warn('[auth] clearAuthCookie failed:', (err as Error).message);
    }
  }

  // ─── Session Cleanup ─────────────────────────────────────────────────────────

  static async cleanupExpiredSessions() {
    return prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
