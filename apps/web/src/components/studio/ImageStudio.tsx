'use client';

import { useState } from 'react';
import { ImageIcon, Sparkles } from 'lucide-react';
import {
  Button,
  Textarea,
  Label,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
} from '@synora/design-system';
import { useImages, useGenerateImage } from '@/hooks/useMedia';
import { GenerationError, MediaStatusBadge, formatCreatedAt, selectClassName } from './shared';

// The backend forwards these to the provider, which rejects combinations it
// does not support. Offering a fixed list beats a free-text box that mostly
// produces provider errors.
const SIZES = ['1024x1024', '1024x1792', '1792x1024'];

export function ImageStudio(): React.JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState(SIZES[0]);

  const { data: images, isLoading } = useImages();
  const generate = useGenerateImage();

  const canSubmit = prompt.trim().length > 0 && !generate.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    generate.mutate(
      { prompt: prompt.trim(), size },
      { onSuccess: () => setPrompt('') }
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="image-prompt">Prompt</Label>
              <Textarea
                id="image-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate…"
                rows={3}
                maxLength={4000}
              />
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="w-44 space-y-2">
                <Label htmlFor="image-size">Size</Label>
                <select
                  id="image-size"
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

              <Button type="submit" disabled={!canSubmit}>
                <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                {generate.isPending ? 'Generating…' : 'Generate image'}
              </Button>
            </div>

            <GenerationError error={generate.error} />
          </form>
        </CardContent>
      </Card>

      <section aria-label="Generated images">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-lg" />
            ))}
          </div>
        ) : !images || images.length === 0 ? (
          <EmptyState
            icon={<ImageIcon className="h-8 w-8" aria-hidden />}
            title="No images yet"
            description="Generated images will appear here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((image) => (
              <Card key={image.id} className="overflow-hidden">
                <div className="relative aspect-square bg-muted">
                  {image.status === 'COMPLETED' && image.imageUrl ? (
                    // Plain <img>, not next/image: these URLs point at
                    // whichever storage backend the deployment configured,
                    // so the host is not knowable at build time and could
                    // not be listed in `images.remotePatterns`.
                    <img
                      src={image.thumbnailUrl ?? image.imageUrl}
                      alt={image.prompt}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <MediaStatusBadge status={image.status} />
                    </div>
                  )}
                </div>
                <CardContent className="space-y-2 p-3">
                  <p className="line-clamp-2 text-sm" title={image.prompt}>
                    {image.prompt}
                  </p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{image.model}</span>
                    <span>{formatCreatedAt(image.createdAt)}</span>
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
