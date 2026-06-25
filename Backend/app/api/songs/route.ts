// api/songs/route.ts — Fixed
// Uses x-user-id header (injected by middleware) instead of AuthService.getCurrentUser()
// This fixes the double DB lookup on every song request

import { NextRequest } from 'next/server';
import { handleRoute } from '@/Backend/application/http/route-handler';
import { UnauthorizedError, ValidationError } from '@/Backend/domains/shared/errors/domain-errors';
import { createSongRequestSchema, listSongsQuerySchema, toSongResponseDto } from '@/Backend/domains/ai/dto/song.dto';
import { CreateSongGenerationUseCase } from '@/Backend/domains/ai/use-cases/create-song-generation.use-case';
import { ListSongsUseCase } from '@/Backend/domains/ai/use-cases/get-and-list-songs.use-case';

function getAuth(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  const role = req.headers.get('x-user-role') || 'USER';
  return userId ? { id: userId, role } : null;
}

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = getAuth(req);
    if (!user) throw new UnauthorizedError();

    const organizationId = req.headers.get('x-organization-id') || undefined;
    const { searchParams } = new URL(req.url);

    const parsed = listSongsQuerySchema.safeParse({
      page: searchParams.get('page') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      genre: searchParams.get('genre') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      sort: searchParams.get('sort') ?? undefined,
      order: searchParams.get('order') ?? undefined,
    });
    if (!parsed.success) throw new ValidationError(parsed.error.flatten());

    const result = await ListSongsUseCase.execute({
      userId: user.id,
      organizationId,
      ...parsed.data,
      sortField: parsed.data.sort,
      sortDirection: parsed.data.order,
    });

    return { songs: result.songs.map(toSongResponseDto), pagination: result.pagination };
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = getAuth(req);
    if (!user) throw new UnauthorizedError();

    const organizationId = req.headers.get('x-organization-id') || undefined;
    const body = await req.json().catch(() => null);
    const parsed = createSongRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten());

    const result = await CreateSongGenerationUseCase.execute({
      userId: user.id,
      organizationId,
      title: parsed.data.title,
      lyrics: parsed.data.lyrics,
      genre: parsed.data.genre,
      mood: parsed.data.mood,
      language: parsed.data.language,
      voiceType: parsed.data.voiceType,
      durationSeconds: parsed.data.duration,
      hasReferenceAudio: parsed.data.hasReferenceAudio,
    });

    return {
      song: { id: result.songId, status: 'PENDING' },
      aiJob: { id: result.aiJobId, status: result.status },
      cost: result.cost,
      message: 'Song queued for generation',
    };
  }, 201);
}
