'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Paperclip } from 'lucide-react';
import {
  useConversationFiles,
  useDeleteFile,
  getFileDownloadUrl,
} from '@/lib/api/files';
import { FileUploadButton } from './FileUploadButton';
import { FilePreview } from './FilePreview';

interface ConversationFilesPanelProps {
  workspaceId: string;
  conversationId: string;
}

/**
 * Collapsible attachments strip for a conversation, mounted above the
 * composer. Server state is the single source of truth — the list
 * comes from useConversationFiles and refreshes automatically after
 * uploads/deletes because those mutations invalidate the same query.
 *
 * Collapsed by default when the conversation has no files, expanded
 * on upload so the user sees where their file went.
 */
export function ConversationFilesPanel({
  workspaceId,
  conversationId,
}: ConversationFilesPanelProps) {
  const { data: files = [] } = useConversationFiles(workspaceId, conversationId);
  const { mutate: deleteFile } = useDeleteFile(workspaceId, conversationId);
  const [expanded, setExpanded] = useState(false);

  const hasFiles = files.length > 0;
  const isOpen = expanded || false;

  const handleDelete = (fileId: string, fileName: string) => {
    if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return;
    deleteFile(fileId);
  };

  return (
    <div className="border-t border-border bg-card px-6 py-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition"
          aria-expanded={isOpen}
          aria-controls="conversation-files"
        >
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Paperclip className="h-3.5 w-3.5" />
          Attachments{hasFiles ? ` (${files.length})` : ''}
        </button>

        <FileUploadButton
          workspaceId={workspaceId}
          conversationId={conversationId}
          onFileUpload={() => setExpanded(true)}
        />
      </div>

      {isOpen && (
        <div id="conversation-files" className="mt-2 space-y-2">
          {hasFiles ? (
            files.map((file) => (
              <FilePreview
                key={file.id}
                file={file}
                downloadUrl={getFileDownloadUrl(workspaceId, conversationId, file.id)}
                onDelete={() => handleDelete(file.id, file.fileName)}
              />
            ))
          ) : (
            <p className="px-1.5 pb-1 text-xs text-muted-foreground">
              No attachments yet. Files you attach are available to this conversation.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
