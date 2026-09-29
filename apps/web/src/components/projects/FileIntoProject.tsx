'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@synora/design-system';
import { api } from '@/lib/api/client';
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
  const router = useRouter();
  const queryClient = useQueryClient();

  const promote = useMutation({
    mutationFn: () =>
      api.post<{ projectId: string; name: string }>(
        `/api/workspaces/${workspaceId}/conversations/${conversationId}/project`,
        {},
      ),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['conversations', conversationId] });
      toast.success(`Created the project "${project.name}" from this conversation`);
      // Taken there, because the realisation that prompted this was about
      // the project — leaving them in the conversation would make them go
      // and find the thing they just created.
      router.push(`/dashboard/projects/${project.projectId}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /**
   * With no projects yet, the only useful offer is to make one FROM this
   * conversation — which is also the moment it is most likely to be what
   * someone wants, since they are already deep in the work.
   */
  if (projects.length === 0) {
    if (projectId) return null;
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => promote.mutate()}
        disabled={promote.isPending}
      >
        {promote.isPending ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <FolderPlus className="mr-1 h-3 w-3" aria-hidden />
        )}
        Make this a project
      </Button>
    );
  }

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

      {/* Offered beside the list, not instead of it: an existing project
          is usually the right home, but sometimes the thing in front of
          you is its own project and picking from a list cannot say that. */}
      {!projectId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => promote.mutate()}
          disabled={promote.isPending}
          className="h-7 px-2 text-xs"
        >
          {promote.isPending ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <FolderPlus className="mr-1 h-3 w-3" aria-hidden />
          )}
          New from this
        </Button>
      )}
    </label>
  );
}
