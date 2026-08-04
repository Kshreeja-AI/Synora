'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileText, Loader2 } from 'lucide-react';
import { useCreateDocument } from '@/lib/api/documents';

/**
 * "Save as doc" — the moment a reply stops being a chat message and
 * becomes a thing of its own.
 *
 * Everything is stated before anything happens: the title is shown and
 * editable, the project filing is a visible checkbox, and the exact
 * reply text is what gets saved — no rewriting, no summarising. After
 * saving, the link to the new document is the proof; a toast that
 * disappears would leave the person unable to find what they just made.
 */

interface SaveAsDocumentProps {
  /** The reply text, saved verbatim as the document body (markdown). */
  content: string;
  /**
   * The project this conversation is filed into, if any. Offered as a
   * pre-checked, uncheckable choice — filing the document alongside the
   * thinking it came from is the common case, but never forced.
   */
  projectId?: string | null;
}

/**
 * First heading or first non-empty line, stripped of markdown markers.
 * A guess the person can overwrite, not a decision made for them.
 */
export function deriveTitle(content: string): string {
  for (const raw of content.split('\n')) {
    const line = raw
      .replace(/^[#>\s]*[-*]?\s*/, '')
      .replace(/[*_`]/g, '')
      .trim();
    if (line) return line.slice(0, 80);
  }
  return 'Saved reply';
}

export function SaveAsDocument({ content, projectId }: SaveAsDocumentProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [fileIntoProject, setFileIntoProject] = useState(true);
  const [savedId, setSavedId] = useState<string | null>(null);
  const create = useCreateDocument();

  if (savedId) {
    // The document now exists; the affordance's job is to take you to it.
    return (
      <Link
        href={`/documents/${savedId}`}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-muted hover:text-foreground"
      >
        <FileText className="h-3 w-3" aria-hidden />
        Saved — open document
      </Link>
    );
  }

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => {
          setTitle(deriveTitle(content));
          setOpen((v) => !v);
        }}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
        aria-label="Save as document"
      >
        <FileText className="h-3 w-3" aria-hidden />
        Save as doc
      </button>

      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-72 space-y-2 rounded-md border border-border bg-background p-3 shadow-md">
          <label className="block text-xs font-medium" htmlFor="save-doc-title">
            Title
          </label>
          <input
            id="save-doc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
          />

          {projectId && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={fileIntoProject}
                onChange={(e) => setFileIntoProject(e.target.checked)}
              />
              File into the same project as this conversation
            </label>
          )}

          <p className="text-xs text-muted-foreground">
            Saves this reply, word for word, as a document of yours.
          </p>

          {create.isError && (
            <p role="alert" className="text-xs text-destructive">
              {create.error instanceof Error ? create.error.message : 'Failed to save'}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={create.isPending || !title.trim()}
              onClick={() =>
                create.mutate(
                  {
                    title: title.trim(),
                    content,
                    ...(projectId && fileIntoProject ? { projectId } : {}),
                  },
                  {
                    onSuccess: (doc) => {
                      setOpen(false);
                      setSavedId(doc.id);
                    },
                  },
                )
              }
              className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
            >
              {create.isPending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              Save
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
