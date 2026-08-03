'use client';

import { useState } from 'react';
import { Clapperboard, Sparkles } from 'lucide-react';
import {
  Button,
  Textarea,
  Input,
  Label,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
} from '@synora/design-system';
import { useVideos, useGenerateVideo } from '@/hooks/useMedia';
import { GenerationError, MediaStatusBadge, formatCreatedAt, selectClassName } from './shared';

const SIZES = ['1280x720', '1920x1080', '720x1280'];

export function VideoStudio(): React.JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState(SIZES[0]);
  const [duration, setDuration] = useState(5);

  const { data: videos, isLoading } = useVideos();
  const generate = useGenerateVideo();

  const durationValid = Number.isInteger(duration) && duration >= 1 && duration <= 60;
  const canSubmit = prompt.trim().length > 0 && durationValid && !generate.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    generate.mutate(
      { prompt: prompt.trim(), size, duration },
      { onSuccess: () => setPrompt('') }
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="video-prompt">Prompt</Label>
              <Textarea
                id="video-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the video you want to generate…"
                rows={3}
                maxLength={4000}
              />
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="w-44 space-y-2">
                <Label htmlFor="video-size">Resolution</Label>
                <select
                  id="video-size"
                  className={selectClassName}
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                >
                  {SIZES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div className="w-36 space-y-2">
                <Label htmlFor="video-duration">Duration (s)</Label>
                <Input
                  id="video-duration"
                  type="number"
                  min={1}
                  max={60}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  aria-invalid={!durationValid}
                />
              </div>

              <Button type="submit" disabled={!canSubmit}>
                <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                {generate.isPending ? 'Starting…' : 'Generate video'}
              </Button>
            </div>

            {!durationValid && (
              <p className="text-sm text-destructive">Duration must be between 1 and 60 seconds.</p>
            )}

            {/* Video generation is async: the request returns as soon as the
                job is accepted, and the gallery below polls it to completion. */}
            <p className="text-sm text-muted-foreground">
              Video jobs run in the background. Progress updates here automatically.
            </p>

            <GenerationError error={generate.error} />
          </form>
        </CardContent>
      </Card>

      <section aria-label="Generated videos">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="aspect-video w-full rounded-lg" />
            ))}
          </div>
        ) : !videos || videos.length === 0 ? (
          <EmptyState
            icon={<Clapperboard className="h-8 w-8" aria-hidden />}
            title="No videos yet"
            description="Generated videos will appear here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {videos.map((video) => (
              <Card key={video.id} className="overflow-hidden">
                <div className="relative aspect-video bg-muted">
                  {video.status === 'COMPLETED' && video.videoUrl ? (
                    <video
                      src={video.videoUrl}
                      poster={video.thumbnailUrl ?? undefined}
                      controls
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <MediaStatusBadge status={video.status} />
                    </div>
                  )}
                </div>
                <CardContent className="space-y-2 p-3">
                  <p className="line-clamp-2 text-sm" title={video.prompt}>
                    {video.prompt}
                  </p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {video.model} · {video.duration}s
                    </span>
                    <span>{formatCreatedAt(video.createdAt)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
