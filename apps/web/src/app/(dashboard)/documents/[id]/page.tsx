'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Spinner } from '@synora/design-system/components/Spinner';
import { Markdown } from '@/components/chat/Markdown';
import { useDocument } from '@/lib/api/documents';

/**
 * One document, whole. The content is rendered exactly as stored — this
 * page adds navigation and nothing else.
 */
export default function DocumentDetailPage() {
  const params = useParams();
  const documentId = params.id as string;
  const { data: doc, isLoading, error } = useDocument(documentId);

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
        <h1 className="mt-2 text-2xl font-semibold">{doc.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Updated {new Date(doc.updatedAt).toLocaleString()}
        </p>
      </div>

      {doc.format === 'MARKDOWN' ? (
        <Markdown className="text-sm">{doc.content}</Markdown>
      ) : (
        <pre className="whitespace-pre-wrap text-sm">{doc.content}</pre>
      )}
    </div>
  );
}
