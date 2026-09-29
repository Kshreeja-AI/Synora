'use client';

import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@synora/design-system';
import { toast } from 'sonner';
import {
  useAgentTemplates,
  useInstantiateTemplate,
  type AgentTemplate,
  type InstantiateResult,
} from '@/lib/api/agentTemplates';

/**
 * Templates as a way past the blank page.
 *
 * TWO THINGS THIS SURFACE MUST NOT IMPLY. First, that a template is doing
 * anything clever — it is a starting configuration, and what it produces
 * is an ordinary agent or workflow you then edit. Second, that the tools
 * it mentions are already connected. They are suggestions in plain
 * language, shown as such, because a template cannot name a tool id that
 * may not exist in this workspace, and pretending otherwise would create
 * something that looks ready and fails on first use.
 */
export function TemplateGallery({
  workspaceId,
  kind,
  onCreated,
}: {
  workspaceId: string;
  kind: 'agent' | 'workflow';
  onCreated?: (result: InstantiateResult) => void;
}) {
  const { data: templates = [], isLoading } = useAgentTemplates(workspaceId, { kind });
  const instantiate = useInstantiateTemplate(workspaceId);

  function use(template: AgentTemplate) {
    instantiate.mutate(
      { templateId: template.id },
      {
        onSuccess: (result) => {
          toast.success(`Created "${template.name}" — edit it to make it yours`);
          onCreated?.(result);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (templates.length === 0) return null;

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4" aria-hidden />
        <h3 className="font-semibold">Start from a template</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Each one creates a real {kind} you can then edit. None of them can use tools yet —
        you add those afterwards, once you know which exist here.
      </p>

      <ul className="grid gap-3 sm:grid-cols-2">
        {templates.map((t) => (
          <li key={t.id} className="flex flex-col gap-2 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">{t.name}</p>
              <p className="text-xs text-muted-foreground">{t.description}</p>
            </div>
            {/* The outcome, in the user's words, is the thing that actually
                helps someone choose — more than a feature list would. */}
            <p className="text-xs italic text-muted-foreground">“{t.outcome}”</p>
            {t.suggestedTools.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Works better once you connect: {t.suggestedTools.join(', ')}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-auto self-start"
              onClick={() => use(t)}
              disabled={instantiate.isPending}
            >
              Use this template
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
