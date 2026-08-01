'use client';

import { useState } from 'react';
import {
  exportConversationMarkdown,
  exportConversationJSON,
  downloadExport,
} from '@/lib/api/messageHistory';
import { Button } from '@synora/design-system/components/Button';
import { Spinner } from '@synora/design-system/components/Spinner';
import { Download, AlertCircle } from 'lucide-react';

interface ConversationExportProps {
  workspaceId: string;
  conversationId: string;
  conversationTitle: string;
}

export function ConversationExport({
  workspaceId,
  conversationId,
  conversationTitle,
}: ConversationExportProps) {
  const [loading, setLoading] = useState<'markdown' | 'json' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async (format: 'markdown' | 'json') => {
    try {
      setLoading(format);
      setError(null);

      let blob: Blob;
      let filename: string;

      if (format === 'markdown') {
        blob = await exportConversationMarkdown(workspaceId, conversationId);
        filename = `${conversationTitle}.md`;
      } else {
        blob = await exportConversationJSON(workspaceId, conversationId);
        filename = `${conversationTitle}.json`;
      }

      downloadExport(blob, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium">Export Format</div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => handleExport('markdown')}
          disabled={loading !== null}
          className="gap-2"
        >
          {loading === 'markdown' ? (
            <>
              <Spinner size="sm" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              Markdown
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => handleExport('json')}
          disabled={loading !== null}
          className="gap-2"
        >
          {loading === 'json' ? (
            <>
              <Spinner size="sm" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              JSON
            </>
          )}
        </Button>
      </div>

      {error && (
        <div className="rounded bg-destructive/10 p-3 text-xs text-destructive flex gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        <p>Export this conversation in your preferred format.</p>
        <p className="mt-1">Markdown is human-readable, JSON contains full metadata.</p>
      </div>
    </div>
  );
}
