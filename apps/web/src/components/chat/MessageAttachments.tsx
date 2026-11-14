'use client';

import React from 'react';
import { MessageAttachment } from '@/lib/api/messages';
import { File, Download } from 'lucide-react';

interface MessageAttachmentsProps {
  attachments: MessageAttachment[];
}

export function MessageAttachments({ attachments }: MessageAttachmentsProps) {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  const images = attachments.filter((a) => a.mimeType.startsWith('image/'));
  const files = attachments.filter((a) => !a.mimeType.startsWith('image/'));

  return (
    <div className="mt-3 space-y-3">
      {/* Image attachments */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((attachment) => (
            <div key={attachment.id} className="relative group">
              <img
                src={attachment.url}
                alt={attachment.name}
                className="max-w-xs max-h-64 rounded-lg border border-border object-cover"
              />
              <div className="absolute inset-0 bg-background/30 rounded-lg transition-opacity flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                <a
                  href={attachment.url}
                  download={attachment.name}
                  className="bg-background text-foreground p-2 rounded-full shadow-lg"
                  title="Download image"
                  aria-label={`Download ${attachment.name}`}
                >
                  <Download className="h-4 w-4 text-foreground " />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* File attachments */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((attachment) => (
            <a
              key={attachment.id}
              href={attachment.url}
              download={attachment.name}
              className="flex items-center gap-2 p-2 bg-muted rounded-lg border border-border hover:bg-accent transition"
            >
              <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {attachment.name}
                </p>
                <p className="text-xs text-muted-foreground ">
                  {(attachment.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <Download className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
