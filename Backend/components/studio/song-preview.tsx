'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Play, Pause, Download } from 'lucide-react';

interface SongPreviewProps {
  audioUrl: string;
  title?: string;
}

export function SongPreview({ audioUrl, title = 'Generated Song' }: SongPreviewProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const pct = (audioRef.current.currentTime / audioRef.current.duration) * 100;
    setProgress(pct || 0);
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <p className="font-medium text-sm">{title}</p>
      <audio ref={audioRef} src={audioUrl} onTimeUpdate={handleTimeUpdate} onEnded={() => setIsPlaying(false)} />
      <Progress value={progress} className="h-1" />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={togglePlay}>
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <a href={audioUrl} download>
  <Button size="sm" variant="outline">
    <Download className="h-4 w-4" />
  </Button>
</a>
      </div>
    </div>
  );
}
