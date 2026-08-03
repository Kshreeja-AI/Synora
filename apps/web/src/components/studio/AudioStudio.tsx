'use client';

import { useState } from 'react';
import { AudioLines, Sparkles } from 'lucide-react';
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
import { useAudioClips, useGenerateAudio } from '@/hooks/useMedia';
import { GenerationError, MediaStatusBadge, formatCreatedAt, selectClassName } from './shared';
import type { GenerateAudioInput } from '@/lib/api/media';

const FORMATS: NonNullable<GenerateAudioInput['format']>[] = ['mp3', 'wav', 'ogg', 'flac', 'aac'];

// Matches the backend's `text` max length so the counter reflects the real limit.
const MAX_TEXT_LENGTH = 4096;

export function AudioStudio(): React.JSX.Element {
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('');
  const [format, setFormat] = useState<NonNullable<GenerateAudioInput['format']>>('mp3');

  const { data: clips, isLoading } = useAudioClips();
  const generate = useGenerateAudio();

  const canSubmit = text.trim().length > 0 && !generate.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    generate.mutate(
      {
        text: text.trim(),
        format,
        // Omit rather than send an empty string — the backend requires at
        // least one character when the field is present.
        ...(voice.trim() ? { voice: voice.trim() } : {}),
      },
      { onSuccess: () => setText('') }
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="audio-text">Text to speak</Label>
              <Textarea
                id="audio-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Enter the text you want spoken aloud…"
                rows={4}
                maxLength={MAX_TEXT_LENGTH}
              />
              <p className="text-right text-xs text-muted-foreground">
                {text.length} / {MAX_TEXT_LENGTH}
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="w-44 space-y-2">
                <Label htmlFor="audio-voice">Voice (optional)</Label>
                <Input
                  id="audio-voice"
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  placeholder="Provider default"
                  maxLength={100}
                />
              </div>

              <div className="w-32 space-y-2">
                <Label htmlFor="audio-format">Format</Label>
                <select
                  id="audio-format"
                  className={selectClassName}
                  value={format}
                  onChange={(e) =>
                    setFormat(e.target.value as NonNullable<GenerateAudioInput['format']>)
                  }
                >
                  {FORMATS.map((option) => (
                    <option key={option} value={option}>
                      {option.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <Button type="submit" disabled={!canSubmit}>
                <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                {generate.isPending ? 'Synthesizing…' : 'Generate speech'}
              </Button>
            </div>

            <GenerationError error={generate.error} />
          </form>
        </CardContent>
      </Card>

      <section aria-label="Generated audio">
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : !clips || clips.length === 0 ? (
          <EmptyState
            icon={<AudioLines className="h-8 w-8" aria-hidden />}
            title="No audio yet"
            description="Generated speech will appear here."
          />
        ) : (
          <div className="space-y-3">
            {clips.map((clip) => (
              <Card key={clip.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <p className="line-clamp-2 text-sm" title={clip.prompt}>
                      {clip.prompt}
                    </p>
                    <MediaStatusBadge status={clip.status} />
                  </div>

                  {clip.status === 'COMPLETED' && clip.audioUrl && (
                    <audio src={clip.audioUrl} controls preload="metadata" className="w-full">
                      <track kind="captions" />
                    </audio>
                  )}

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{clip.model}</span>
                    <span>{formatCreatedAt(clip.createdAt)}</span>
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
