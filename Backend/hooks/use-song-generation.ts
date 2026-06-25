'use client';

import { useState, useCallback } from 'react';

export interface SongGenerationState {
  isGenerating: boolean;
  progress: number;
  songId: string | null;
  audioUrl: string | null;
  error: string | null;
  status: 'idle' | 'queued' | 'processing' | 'completed' | 'failed';
}

export function useSongGeneration() {
  const [state, setState] = useState<SongGenerationState>({
    isGenerating: false,
    progress: 0,
    songId: null,
    audioUrl: null,
    error: null,
    status: 'idle',
  });

  const startGeneration = useCallback(async (data: Record<string, unknown>) => {
    setState((prev) => ({ ...prev, isGenerating: true, progress: 0, error: null, status: 'queued', audioUrl: null }));

    try {
      const res = await fetch('/api/studio/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || 'Generation failed');
      }

      const { song, aiJob } = json.data;
      setState((prev) => ({ ...prev, songId: song.id, status: 'processing' }));

      // Poll for completion
      await pollForCompletion(song.id);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isGenerating: false,
        error: (err as Error).message,
        status: 'failed',
      }));
    }
  }, []);

  const pollForCompletion = useCallback(async (songId: string) => {
    const maxAttempts = 60;
    let attempts = 0;

    const poll = async (): Promise<void> => {
      if (attempts >= maxAttempts) {
        setState((prev) => ({ ...prev, isGenerating: false, error: 'Generation timed out', status: 'failed' }));
        return;
      }
      attempts++;

      try {
        const res = await fetch(`/api/songs/${songId}`, { credentials: 'include' });
        const json = await res.json();

        if (!res.ok) return;

        const song = json.data?.song || json.song;
        if (!song) return;

        setState((prev) => ({ ...prev, progress: song.progress || 0 }));

        if (song.status === 'COMPLETED') {
          setState((prev) => ({
            ...prev,
            isGenerating: false,
            progress: 100,
            audioUrl: song.audioUrl,
            status: 'completed',
          }));
          return;
        }

        if (song.status === 'FAILED') {
          setState((prev) => ({
            ...prev,
            isGenerating: false,
            error: song.errorMessage || 'Generation failed',
            status: 'failed',
          }));
          return;
        }

        await new Promise((r) => setTimeout(r, 3000));
        return poll();
      } catch {
        await new Promise((r) => setTimeout(r, 3000));
        return poll();
      }
    };

    await poll();
  }, []);

  const reset = useCallback(() => {
    setState({ isGenerating: false, progress: 0, songId: null, audioUrl: null, error: null, status: 'idle' });
  }, []);

  return { ...state, startGeneration, reset };
}
