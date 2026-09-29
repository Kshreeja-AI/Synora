'use client';

/**
 * Export menu for a conversation: two download links, one per format.
 * These are plain anchor navigations to the backend's streaming
 * export endpoint — the browser handles the download natively (cookie
 * auth, Content-Disposition filename), so there's no blob plumbing,
 * no loading state to get wrong, and it works even if JS is degraded.
 */

import { useState, useRef, useEffect } from 'react';
import { Download, FileJson, FileText, ChevronDown } from 'lucide-react';
import { Button } from '@synora/design-system/components/Button';
import { getConversationExportUrl } from '@/lib/api/conversationExport';

interface ConversationExportProps {
  workspaceId: string;
  conversationId: string;
}

export function ConversationExport({
  workspaceId,
  conversationId,
}: ConversationExportProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click — a menu that only closes via its own
  // button traps the user.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        className="gap-2"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Download className="h-4 w-4" />
        Export
        <ChevronDown className="h-3 w-3" />
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="Export format"
          className="absolute right-0 top-full z-10 mt-1 w-48 rounded-md border border-border bg-popover p-1 shadow-md"
        >
          <a
            role="menuitem"
            href={getConversationExportUrl(workspaceId, conversationId, 'markdown')}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent"
          >
            <FileText className="h-4 w-4 text-muted-foreground" />
            Download as Markdown
          </a>
          <a
            role="menuitem"
            href={getConversationExportUrl(workspaceId, conversationId, 'json')}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-foreground hover:bg-accent"
          >
            <FileJson className="h-4 w-4 text-muted-foreground" />
            Download as JSON
          </a>
        </div>
      )}
    </div>
  );
}
