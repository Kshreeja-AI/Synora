'use client';

import Link from 'next/link';
import {
  Bot,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  MessageSquare,
  Music,
  Paperclip,
  PlayCircle,
  Video,
} from 'lucide-react';
import { Button } from '@synora/design-system';
import {
  useProjectWorkspace,
  type ProjectItemKind,
  type ProjectTimelineEntry,
} from '@/lib/api/projectWorkspace';

/**
 * What has happened in this project, and where to pick up.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO.
 *
 * It does not judge the project. "Last touched three weeks ago" is a fact
 * someone can interpret however their situation warrants; "this project is
 * stalled" would be the platform deciding something about their work that
 * it has no standing to decide, and would be wrong exactly when it
 * mattered — during a deliberate pause.
 *
 * It does not invent a summary of the work. Everything shown is a real
 * title, a real timestamp and a real count, read from the things
 * themselves. A generated "here's where you are" paragraph would be the
 * one part of this panel that could be confidently wrong.
 */

const ICONS: Record<ProjectItemKind, typeof MessageSquare> = {
  conversation: MessageSquare,
  canvas: LayoutGrid,
  file: Paperclip,
  document: FileText,
  image: ImageIcon,
  video: Video,
  audio: Music,
  agentRun: Bot,
};

const LABELS: Record<ProjectItemKind, string> = {
  conversation: 'conversation',
  canvas: 'canvas',
  file: 'file',
  document: 'document',
  image: 'image',
  video: 'video',
  audio: 'audio',
  agentRun: 'agent run',
};

/** Relative where it helps, absolute where precision matters more. */
function when(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

function href(entry: ProjectTimelineEntry): string | null {
  // Only kinds with a page to open get a link. The rest are listed
  // without one rather than given one that goes nowhere.
  if (entry.kind === 'conversation') return `/conversations/${entry.id}`;
  if (entry.kind === 'document') return `/documents/${entry.id}`;
  return null;
}

export function ProjectWorkspacePanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useProjectWorkspace(projectId);

  if (isLoading || !data) return null;

  const { counts, timeline, resumeConversationId, project, lastActivityAt } = data;
  const held = (Object.keys(counts) as ProjectItemKind[]).filter((k) => counts[k] > 0);

  return (
    <section className="space-y-4 rounded-md border p-4" aria-labelledby="project-work-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="project-work-heading" className="font-semibold">
            The work
          </h2>
          {project.goal ? (
            <p className="mt-1 max-w-prose text-sm">
              <span className="text-muted-foreground">Goal: </span>
              {project.goal}
            </p>
          ) : (
            // Offered, never demanded: many projects only become clear
            // once they are underway.
            <p className="mt-1 text-sm text-muted-foreground">
              No goal set. Adding one gives this project something to be finished against.
            </p>
          )}
          {lastActivityAt && (
            // A fact, not a verdict.
            <p className="mt-1 text-xs text-muted-foreground">Last activity {when(lastActivityAt)}.</p>
          )}
        </div>

        {resumeConversationId && (
          <Button asChild>
            <Link href={`/conversations/${resumeConversationId}`}>
              <PlayCircle className="mr-2 h-4 w-4" aria-hidden />
              Continue where you left off
            </Link>
          </Button>
        )}
      </div>

      {held.length > 0 && (
        <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {held.map((kind) => {
            const Icon = ICONS[kind];
            return (
              <li key={kind} className="flex items-center gap-1">
                <Icon className="h-3 w-3" aria-hidden />
                {counts[kind]} {LABELS[kind]}
                {counts[kind] === 1 ? '' : 's'}
              </li>
            );
          })}
        </ul>
      )}

      {timeline.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Conversations you file into this project, and files you upload, will
          appear as a history you can come back to.
        </p>
      ) : (
        <ol className="space-y-1">
          {timeline.slice(0, 20).map((entry) => {
            const Icon = ICONS[entry.kind];
            const link = href(entry);
            const body = (
              <>
                <Icon className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1">
                  {entry.title || '(untitled)'}
                  <span className="block text-xs text-muted-foreground">
                    {LABELS[entry.kind]} · {when(entry.at)}
                    {entry.detail ? ` · ${entry.detail}` : ''}
                  </span>
                </span>
              </>
            );
            return (
              <li key={`${entry.kind}:${entry.id}`} className="text-sm">
                {link ? (
                  <Link
                    href={link}
                    className="flex gap-2 rounded-md p-2 hover:bg-muted focus-visible:bg-muted"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex gap-2 p-2">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
