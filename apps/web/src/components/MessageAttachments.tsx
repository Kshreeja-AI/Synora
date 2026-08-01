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
                className="max-w-xs max-h-64 rounded-lg border border-gray-200 dark:border-gray-700 object-cover"
              />
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 rounded-lg transition-opacity flex items-center justify-center opacity-0 group-hover:opacity-100">
                <a
                  href={attachment.url}
                  download={attachment.name}
                  className="bg-white dark:bg-gray-900 p-2 rounded-full shadow-lg"
                  title="Download image"
                >
                  <Download className="h-4 w-4 text-gray-700 dark:text-gray-300" />
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
              className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              <File className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {attachment.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {(attachment.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <Download className="h-4 w-4 text-gray-400 flex-shrink-0" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
