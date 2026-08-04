'use client';

import { useQuery } from '@tanstack/react-query';
import { LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { listProjects } from '@/lib/api/projects';
import { useSetCanvasProject } from '@/lib/api/canvas';

/**
 * Which project a canvas belongs to.
 *
 * Deliberately the same shape as the conversation's control: a select that
 * states where the thing currently sits and changes it in one step. Two
 * surfaces that do the same job should not ask people to learn it twice.
 *
 * There is no "make a project from this canvas" here, unlike on a
 * conversation. A conversation carries a title someone wrote and a thread
 * of reasoning that names itself; a canvas is usually named "Untitled" for
 * a while and is arranged before it is described. Promoting one would
 * produce a project called "Untitled" more often than not — so the offer
 * would look helpful and produce clutter.
 */
export function CanvasProjectSelect({
  workspaceId,
  canvasId,
  projectId,
}: {
  workspaceId: string;
  canvasId: string;
  projectId?: string;
}) {
  const { data: projects = [] } = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => listProjects(workspaceId),
    enabled: !!workspaceId,
  });

  const setProject = useSetCanvasProject(workspaceId);

  if (projects.length === 0) return null;

  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      <LayoutGrid className="h-3 w-3" aria-hidden />
      <span className="sr-only">Project</span>
      <select
        aria-label="File this canvas into a project"
        value={projectId ?? ''}
        onChange={(e) =>
          setProject.mutate(
            {
              canvasId,
              // Explicit null takes it out; an omitted field would leave
              // it filed where it was.
              projectId: e.target.value === '' ? null : e.target.value,
            },
            {
              onSuccess: (canvas) =>
                toast.success(
                  canvas.projectId ? 'Filed into the project' : 'Taken out of the project',
                ),
              onError: (error) => toast.error(error.message),
            },
          )
        }
        disabled={setProject.isPending}
        className="h-8 rounded-md border border-input bg-background px-1 text-xs"
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
