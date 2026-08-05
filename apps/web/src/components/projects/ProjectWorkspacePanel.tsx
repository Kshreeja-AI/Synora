'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Bot,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Music,
  Paperclip,
  PlayCircle,
  Sparkles,
  StickyNote,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@synora/design-system';
import {
  useAddProjectNote,
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
  note: StickyNote,
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
  note: 'note',
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
  if (entry.kind === 'agentRun') return `/agents/runs/${entry.id}`;
  return null;
}

export function ProjectWorkspacePanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useProjectWorkspace(projectId);
  const addNote = useAddProjectNote(projectId);
  const [noteText, setNoteText] = useState('');
  /** The note being corrected, if any — a correction is a NEW note. */
  const [correctingId, setCorrectingId] = useState<string | null>(null);

  if (isLoading || !data) return null;

  function submitNote() {
    const content = noteText.trim();
    if (!content) return;
    addNote.mutate(
      { content, correctsNoteId: correctingId ?? undefined },
      {
        onSuccess: () => {
          setNoteText('');
          setCorrectingId(null);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  const {
    counts,
    timeline,
    resumeConversationId,
    project,
    lastActivityAt,
    newSinceLastVisit,
    decisions,
  } = data;
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

      {/*
        Absent on a first-ever visit (nothing to measure "since" yet) and
        absent when nothing changed — a banner announcing zero new things
        would be noise dressed as information. Shown only when it says
        something a returning person actually needs: what happened here
        while they were away, so picking work back up after months does
        not mean starting from zero.
      */}
      {newSinceLastVisit && newSinceLastVisit.count > 0 && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            {newSinceLastVisit.count} new since you were last here
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {(Object.keys(newSinceLastVisit.byKind) as ProjectItemKind[]).map((kind) => {
              const n = newSinceLastVisit.byKind[kind] ?? 0;
              return (
                <li key={kind} className="flex items-center gap-1">
                  {n} {LABELS[kind]}
                  {n === 1 ? '' : 's'}
                </li>
              );
            })}
          </ul>
        </div>
      )}

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

      {/*
        One field, no category, no dialog — "why we decided this" is
        recorded accurately only when writing it down costs almost
        nothing. A richer form would be filled in honestly only in
        hindsight, by which point the reasoning is already half-forgotten.
      */}
      <div className="flex items-start gap-2">
        <StickyNote className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex-1 space-y-1.5">
          {correctingId && (
            // Said before the click: the original is never edited or
            // erased — it stays in the timeline, marked.
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              Correcting an earlier note. The original stays visible, marked as corrected.
              <button
                type="button"
                onClick={() => setCorrectingId(null)}
                className="underline hover:text-foreground"
              >
                Cancel correction
              </button>
            </p>
          )}
          <label htmlFor="project-note-input" className="sr-only">
            Add a note about why a decision was made
          </label>
          <textarea
            id="project-note-input"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Note why a decision was made, for later…"
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-background p-2 text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={submitNote}
            disabled={!noteText.trim() || addNote.isPending}
          >
            {addNote.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
            ) : null}
            Add note
          </Button>
        </div>
      </div>

      {/*
        The decision log, whole — full verbatim content, never crowded
        out of view by other activity the way old timeline entries can
        be. Collapsed by default: it reads when wanted, like the run
        log, and claims no attention when not. Absent when empty.
      */}
      {decisions.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">
            Decisions ({decisions.length})
          </summary>
          <ol className="mt-2 space-y-2">
            {decisions.map((d) => (
              <li key={d.id} className="rounded-md border p-3 text-sm">
                <p className="whitespace-pre-wrap">{d.content}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {d.author ?? 'Someone'} · {when(d.at)}
                  {d.correction ? ' · correction' : ''}
                  {d.correctedLater ? ' · corrected by a later note' : ''}
                </p>
              </li>
            ))}
          </ol>
        </details>
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
                  <div className="flex gap-2 p-2">
                    {body}
                    {/* A note already marked corrected does not offer a
                        second correction from here — the newest note is
                        the one to correct, and offering both would make
                        two chains where the person meant one. */}
                    {entry.kind === 'note' && !entry.detail?.includes('corrected by') && (
                      <button
                        type="button"
                        onClick={() => setCorrectingId(entry.id)}
                        aria-label={`Correct the note “${entry.title}”`}
                        className="self-start rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        Correct
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
