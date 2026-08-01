'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePublicTemplates } from '@/lib/api/templates';
import { Template, TEMPLATE_CATEGORIES } from '@/lib/api/templates';
import { Spinner } from '@synora/design-system/components/Spinner';
import { BookOpen, ArrowRight } from 'lucide-react';

interface TemplateGalleryProps {
  workspaceId: string;
}

export function TemplateGallery({ workspaceId }: TemplateGalleryProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  const { data: templates, isLoading, error } = usePublicTemplates(
    workspaceId,
    selectedCategory || undefined
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-destructive/10 p-4 text-destructive">
        <p className="font-medium">Failed to load templates</p>
        <p className="text-sm opacity-75">Please try again later</p>
      </div>
    );
  }

  const templateList = templates || [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-3">Choose a Template</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory('')}
            className={`rounded-lg px-3 py-1 text-sm font-medium transition ${
              selectedCategory === ''
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted-foreground/20'
            }`}
          >
            All
          </button>
          {TEMPLATE_CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setSelectedCategory(cat.value)}
              className={`rounded-lg px-3 py-1 text-sm font-medium transition ${
                selectedCategory === cat.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted-foreground/20'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {templateList.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed p-12 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
          <h3 className="font-medium text-foreground mb-1">No templates found</h3>
          <p className="text-sm text-muted-foreground">
            No templates in this category. Try another one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templateList.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              workspaceId=""
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
}: {
  template: Template;
  workspaceId: string;
}) {
  const router = useRouter();

  const handleStart = () => {
    router.push(
      `/conversations/new?template=${template.id}`
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 hover:shadow-md transition">
      <div className="space-y-3">
        <div>
          <h3 className="font-semibold text-foreground line-clamp-2">
            {template.title}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {template.description || template.category}
          </p>
        </div>

        {template.initialUserMessage && (
          <p className="text-sm text-muted-foreground line-clamp-3">
            "{template.initialUserMessage}"
          </p>
        )}

        {template.suggestedFollowUps.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Follow-up suggestions:
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {template.suggestedFollowUps.slice(0, 2).map((followUp, i) => (
                <li key={i} className="line-clamp-1">
                  • {followUp}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          onClick={handleStart}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
        >
          Start Conversation
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
