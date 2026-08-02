'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Conversation } from '@/lib/types/conversations';
import type { Template } from '@/lib/api/templates';

const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_MODEL = 'claude-sonnet-5';

/**
 * Start a new conversation from a template: create the conversation,
 * seed the template's system prompt as its first SYSTEM message, then
 * navigate to it.
 *
 * The template's `initialUserMessage` is deliberately NOT sent here.
 * Posting a USER message kicks off assistant generation, and the
 * generated tokens stream to whoever holds the SSE subscription — this
 * page navigates away immediately, so the response would be produced
 * with nobody watching it arrive. The user sends the first message from
 * the chat view, where the stream is wired.
 */
export function useStartFromTemplate(workspaceId: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async (template: Template): Promise<void> => {
      if (!workspaceId) return;
      setStartingId(template.id);
      setError(null);

      try {
        const conversation = await api.post<Conversation>(
          `/api/workspaces/${workspaceId}/conversations`,
          {
            title: template.title,
            description: template.description || undefined,
            provider: DEFAULT_PROVIDER,
            model: DEFAULT_MODEL,
          }
        );

        if (template.systemPrompt) {
          await api.post(
            `/api/workspaces/${workspaceId}/conversations/${conversation.id}/messages`,
            { content: template.systemPrompt, role: 'SYSTEM' }
          );
        }

        await queryClient.invalidateQueries({ queryKey: ['conversations', workspaceId] });
        router.push(`/conversations/${conversation.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start conversation');
        setStartingId(null);
      }
    },
    [workspaceId, queryClient, router]
  );

  return { start, startingId, error };
}
