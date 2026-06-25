// api/songs/[id]/route.ts — Fixed typed role

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleRoute } from "@/Backend/application/http/route-handler";
import {
  UnauthorizedError,
  ValidationError,
} from "@/Backend/domains/shared/errors/domain-errors";
import { GetSongUseCase } from "@/Backend/domains/ai/use-cases/get-and-list-songs.use-case";
import {
  UpdateSongUseCase,
  DeleteSongUseCase,
  isValidSongId,
} from "@/Backend/domains/ai/use-cases/update-and-delete-song.use-case";
import { z } from "zod";

type UserRole = "ADMIN" | "SUPER_ADMIN" | "USER";

const updateSongSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  isPublic: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  lyrics: z.string().max(10000).optional(),
});

function normalizeRole(role: string | null): UserRole {
  return role === "ADMIN" || role === "SUPER_ADMIN" || role === "USER"
    ? role
    : "USER";
}

function getAuth(req: NextRequest): { id: string; role: UserRole } | null {
  const userId = req.headers.get("x-user-id");
  const role = normalizeRole(req.headers.get("x-user-role"));

  return userId ? { id: userId, role } : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return handleRoute(async () => {
    if (!isValidSongId(params.id)) {
      throw new ValidationError({ id: "Invalid song ID" });
    }

    const user = getAuth(req);
    if (!user) throw new UnauthorizedError();

    const organizationId = req.headers.get("x-organization-id") || undefined;

    const song = await GetSongUseCase.execute({
      songId: params.id,
      userId: user.id,
      organizationId,
      role: user.role,
    });

    const jobs = await prisma.aIJob.findMany({
      where: { songId: song.id },
      select: {
        id: true,
        type: true,
        status: true,
        progress: true,
        createdAt: true,
      },
    });

    return { song: { ...song, jobs } };
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return handleRoute(async () => {
    if (!isValidSongId(params.id)) {
      throw new ValidationError({ id: "Invalid song ID" });
    }

    const user = getAuth(req);
    if (!user) throw new UnauthorizedError();

    const body = await req.json().catch(() => null);
    const parsed = updateSongSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(parsed.error.flatten());
    }

    const song = await UpdateSongUseCase.execute({
      songId: params.id,
      userId: user.id,
      data: parsed.data,
    });

    return { song };
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return handleRoute(async () => {
    if (!isValidSongId(params.id)) {
      throw new ValidationError({ id: "Invalid song ID" });
    }

    const user = getAuth(req);
    if (!user) throw new UnauthorizedError();

    await DeleteSongUseCase.execute({
      songId: params.id,
      userId: user.id,
      role: user.role,
    });

    return { message: "Song deleted successfully" };
  });
}
