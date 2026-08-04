'use client';

import { useQuery } from '@tanstack/react-query';
import { FolderPlus } from 'lucide-react';
import { toast } from 'sonner';
import { listProjects } from '@/lib/api/projects';
import { useUpdateConversation } from '@/lib/api/conversations';

/**
 * Filing a conversation into a project.
 *
 * WHY THIS IS A SELECT AND NOT A "SAVE TO PROJECT" BUTTON. A button would
 * have to either pick a project for the person or open a dialog to ask.
 * Picking for them is the platform guessing at something it cannot know;
 * a dialog is a second step for a one-word decision. A select shows where
 * the conversation currently sits AND changes it, in one control, which is
 * also what makes "take it out again" discoverable rather than hidden
 * behind a different affordance.
 *
 * THE CURRENT PROJECT IS THE SELECTED VALUE, so this is a statement of
 * fact before it is a control. Someone arriving at a conversation can see
 * whether it belongs anywhere without clicking.
 *
 * IT DISAPPEARS WHEN THERE ARE NO PROJECTS rather than showing an empty
 * dropdown. An empty control invites a click that leads nowhere, and
 * telling someone to "create a project first" mid-conversation is an
 * errand, not an answer.
 */
export function FileIntoProject({
  workspaceId,
  conversationId,
  projectId,
}: {
  workspaceId: string;
  conversationId: string;
  projectId?: string | null;
}) {
  const { data: projects = [] } = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => listProjects(workspaceId),
    enabled: !!workspaceId,
  });

  const update = useUpdateConversation(workspaceId, conversationId);

  if (projects.length === 0) return null;

  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      <FolderPlus className="h-3 w-3" aria-hidden />
      <span className="sr-only">Project</span>
      <select
        aria-label="File this conversation into a project"
        value={projectId ?? ''}
        onChange={(e) =>
          update.mutate(
            // Empty string means "no project", which the API expects as an
            // explicit null — omitting the field would silently leave it
            // filed where it was.
            { projectId: e.target.value === '' ? null : e.target.value },
            {
              onSuccess: (conversation) =>
                toast.success(
                  conversation.projectId
                    ? 'Filed into the project'
                    : 'Taken out of the project',
                ),
              onError: (error) => toast.error(error.message),
            },
          )
        }
        disabled={update.isPending}
        className="h-7 rounded-md border border-input bg-background px-1 text-xs"
      >
        <option value="">No project</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </label>
  );
}
