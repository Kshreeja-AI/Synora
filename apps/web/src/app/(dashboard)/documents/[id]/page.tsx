'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FolderKanban, Loader2, Pencil } from 'lucide-react';
import { Spinner } from '@synora/design-system/components/Spinner';
import { Markdown } from '@/components/chat/Markdown';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDocument, useUpdateDocument } from '@/lib/api/documents';
import { getProject } from '@/lib/api/projects';

/**
 * One document, whole — readable by default, editable on request.
 *
 * Editing is plain text over the stored markdown: what is in the
 * textarea is exactly what will be stored, no richer claim than the
 * platform can keep. Cancel discards; nothing is saved until Save.
 *
 * A document filed into a shared project is readable by that project's
 * people, but editing stays owner-only (the server enforces this; the
 * Edit button is hidden here too, rather than letting a non-owner reach
 * a Save that would just 404).
 *
 * When filed, the project is named and linked — landing here from a
 * project's timeline should not be a dead end with no way back, and a
 * document reached some other way should still say what it belongs to.
 * Changing that filing is not offered here: doing it honestly would mean
 * picking from every project across every workspace this person is in,
 * a picker nothing else in the product has built yet. Refiling stays
 * where the context already exists — "Save as doc" and the conversation
 * page's project select.
 */
export default function DocumentDetailPage() {
  const params = useParams();
  const documentId = params.id as string;
  const { data: currentUser } = useCurrentUser();
  const { data: doc, isLoading, error } = useDocument(documentId);
  const update = useUpdateDocument(documentId);
  const { data: project } = useQuery({
    queryKey: ['project', doc?.projectId],
    queryFn: () => getProject(doc!.projectId!),
    enabled: !!doc?.projectId,
    // If the project became unreachable (e.g. the owner left its
    // workspace), degrade to showing the document without the label
    // rather than retrying a call that will keep failing the same way.
    retry: false,
  });

  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <p role="alert" className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'This document could not be found.'}
        </p>
        <Link href="/documents" className="inline-flex items-center gap-1 text-sm underline">
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Back to documents
        </Link>
      </div>
    );
  }

  const canEdit = !!currentUser && currentUser.id === doc.userId;

  const startEditing = () => {
    // Prefill from what is stored NOW, not from a stale first render.
    setTitle(doc.title);
    setContent(doc.content);
    setIsEditing(true);
  };

  const save = () => {
    update.mutate(
      { title: title.trim(), content },
      { onSuccess: () => setIsEditing(false) },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link
          href="/documents"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Documents
        </Link>

        {isEditing ? (
          <input
            aria-label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-2xl font-semibold"
          />
        ) : (
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold">{doc.title}</h1>
            {canEdit && (
              <button
                type="button"
                onClick={startEditing}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
              >
                <Pencil className="h-3 w-3" aria-hidden />
                Edit
              </button>
            )}
          </div>
        )}

        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Updated {new Date(doc.updatedAt).toLocaleString()}</span>
          {project && (
            <Link
              href={`/dashboard/projects/${project.id}`}
              className="flex items-center gap-1 hover:text-foreground hover:underline"
            >
              <FolderKanban className="h-3 w-3" aria-hidden />
              Filed in {project.name}
            </Link>
          )}
        </p>
      </div>

      {isEditing ? (
        <div className="space-y-3">
          <textarea
            aria-label="Content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={16}
            className="w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
          />
          {update.isError && (
            <p role="alert" className="text-xs text-destructive">
              {update.error instanceof Error ? update.error.message : 'Failed to save'}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={update.isPending || !title.trim()}
              className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              {update.isPending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              Save
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : doc.format === 'MARKDOWN' ? (
        <Markdown className="text-sm">{doc.content}</Markdown>
      ) : (
        <pre className="whitespace-pre-wrap text-sm">{doc.content}</pre>
      )}
    </div>
  );
}
