// api/admin/analytics/route.ts — Admin Analytics
// Auth + admin role check handled by global middleware (x-user-id header injected)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  // Role already verified by middleware (ADMIN/SUPER_ADMIN only)
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || '30d';
    const daysAgo = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
    const startDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      newUsers,
      totalSongs,
      songsByStatus,
      songsByGenre,
      revenue,
      activeSubscriptions,
      apiUsage,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: startDate } } }),
      prisma.song.count(),
      prisma.song.groupBy({ by: ['status'], _count: true }),
      prisma.song.groupBy({ by: ['genre'], _count: true, where: { createdAt: { gte: startDate } } }),
      prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'completed', createdAt: { gte: startDate } } }),
      prisma.subscription.count({ where: { status: 'active' } }),
      prisma.auditLog.count({ where: { createdAt: { gte: startDate }, action: { startsWith: 'API_' } } }),
    ]);

    const dailyStats = await getDailyStats(startDate);

    return NextResponse.json({
      overview: {
        totalUsers,
        newUsers,
        totalSongs,
        revenue: revenue._sum.amount || 0,
        activeSubscriptions,
        apiUsage,
      },
      songsByStatus: Object.fromEntries(songsByStatus.map(({ status, _count }) => [status, _count])),
      songsByGenre: Object.fromEntries(songsByGenre.map(({ genre, _count }) => [genre, _count])),
      dailyStats,
    });
  } catch (error) {
    console.error('[admin/analytics] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getDailyStats(startDate: Date) {
  const stats = [];
  let currentDate = new Date(startDate);
  const endDate = new Date();

  while (currentDate <= endDate) {
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const [songs, users, payments] = await Promise.all([
      prisma.song.count({ where: { createdAt: { gte: currentDate, lt: nextDate } } }),
      prisma.user.count({ where: { createdAt: { gte: currentDate, lt: nextDate } } }),
      prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'completed', createdAt: { gte: currentDate, lt: nextDate } } }),
    ]);

    stats.push({
      date: currentDate.toISOString().split('T')[0],
      songs,
      newUsers: users,
      revenue: payments._sum.amount || 0,
    });

    currentDate = nextDate;
  }

  return stats;
}
