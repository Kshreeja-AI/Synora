'use client';

import { ConversationMessage } from '@/lib/api/messages';
import { FilePreview } from './FilePreview';

interface FileGalleryProps {
  message: ConversationMessage;
  workspaceId: string;
  conversationId: string;
  onDelete?: (attachmentId: string) => void;
}

export function FileGallery({
  message,
  workspaceId: _workspaceId,
  conversationId: _conversationId,
  onDelete,
}: FileGalleryProps) {
  if (!message.attachments || message.attachments.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 mt-2">
      {message.attachments.map((attachment) => (
        <FilePreview
          key={attachment.id}
          file={{
            id: attachment.id,
            fileName: attachment.name,
            mimeType: attachment.mimeType,
            fileSize: attachment.size,
            storageKey: attachment.url,
            uploadedAt: new Date().toISOString(), // Use message createdAt in real scenario
          }}
          downloadUrl={attachment.url}
          onDelete={onDelete ? () => onDelete(attachment.id) : undefined}
        />
      ))}
    </div>
  );
}
