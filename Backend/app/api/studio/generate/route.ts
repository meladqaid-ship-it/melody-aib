// app/api/studio/generate/route.ts — Studio Generation Endpoint

import { NextRequest } from 'next/server';
import { handleRoute } from '@/Backend/application/http/route-handler';
import { UnauthorizedError, ValidationError } from '@/Backend/domains/shared/errors/domain-errors';
import { createSongRequestSchema } from '@/Backend/domains/ai/dto/song.dto';
import { CreateSongGenerationUseCase } from '@/Backend/domains/ai/use-cases/create-song-generation.use-case';

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    // Auth header injected by global middleware after JWT verification
    const userId = req.headers.get('x-user-id');
    if (!userId) throw new UnauthorizedError();

    const organizationId = req.headers.get('x-organization-id') || undefined;

    const body = await req.json().catch(() => null);
    const parsed = createSongRequestSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten());

    const result = await CreateSongGenerationUseCase.execute({
      userId,
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
