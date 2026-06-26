import { prisma } from '@/lib/prisma';

export async function getSaaSContext(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      credits: true,
    },
  });

  if (!user) throw new Error('USER_NOT_FOUND');

  const isOwner = user.role === 'SUPER_ADMIN';
  const unlimited = isOwner;

  return {
    user,
    isOwner,
    unlimited,
  };
}
