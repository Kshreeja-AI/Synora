'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@synora/design-system';
import { ImageStudio } from '@/components/studio/ImageStudio';
import { VideoStudio } from '@/components/studio/VideoStudio';
import { AudioStudio } from '@/components/studio/AudioStudio';

/**
 * Media Studio — the front end for the image, video and text-to-speech
 * generation backends, which shipped with no UI at all.
 *
 * The tab lives in the URL (`?tab=video`) so a particular studio is
 * linkable and survives a refresh, matching how the search page treats its
 * own filters.
 */

type StudioTab = 'image' | 'video' | 'audio';

const TABS: StudioTab[] = ['image', 'video', 'audio'];

function isStudioTab(value: string | null): value is StudioTab {
  return value !== null && (TABS as string[]).includes(value);
}

function StudioPageInner() {
  const params = useSearchParams();
  const router = useRouter();

  const raw = params.get('tab');
  const tab: StudioTab = isStudioTab(raw) ? raw : 'image';

  function handleTabChange(next: string) {
    const query = new URLSearchParams(params.toString());
    query.set('tab', next);
    router.replace(`/studio?${query.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Media Studio</h1>
        <p className="text-sm text-muted-foreground">
          Generate images, video and speech. Each medium uses whichever provider this deployment
          has configured.
        </p>
      </header>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="image">Image</TabsTrigger>
          <TabsTrigger value="video">Video</TabsTrigger>
          <TabsTrigger value="audio">Speech</TabsTrigger>
        </TabsList>

        <TabsContent value="image" className="mt-6">
          <ImageStudio />
        </TabsContent>
        <TabsContent value="video" className="mt-6">
          <VideoStudio />
        </TabsContent>
        <TabsContent value="audio" className="mt-6">
          <AudioStudio />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function StudioPage(): React.JSX.Element {
  // useSearchParams needs a Suspense boundary to avoid opting the whole
  // route into client-side rendering at build time.
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading studio…</div>}>
      <StudioPageInner />
    </Suspense>
  );
}
