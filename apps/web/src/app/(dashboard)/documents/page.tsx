'use client';

import Link from 'next/link';
import { FileText } from 'lucide-react';
import { Spinner } from '@synora/design-system/components/Spinner';
import { useDocuments } from '@/lib/api/documents';

/**
 * Your documents — the things replies and drafts become when they stop
 * being messages.
 *
 * Documents are personal, not workspace-scoped: this list is yours and
 * follows you across workspaces. That is said on the page rather than
 * left for people to discover by switching workspaces and being
 * surprised the list didn't change.
 */
export default function DocumentsPage() {
  const { data: documents, isLoading, error } = useDocuments();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Documents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Yours, across all workspaces. Replies you save from a conversation land here.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'Failed to load documents'}
        </p>
      )}

      {documents && documents.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No documents yet. In a conversation, “Save as doc” on any reply turns it into one.
        </p>
      )}

      {documents && documents.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {documents.map((doc) => (
            <li key={doc.id}>
              <Link
                href={`/documents/${doc.id}`}
                className="flex items-start gap-3 p-4 hover:bg-muted focus-visible:bg-muted"
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{doc.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    Updated {new Date(doc.updatedAt).toLocaleString()}
                    {doc.projectId ? ' · filed in a project' : ''}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
