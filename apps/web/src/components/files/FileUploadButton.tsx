'use client';

import { useState, useRef } from 'react';
import { Paperclip } from 'lucide-react';
import { Button } from '@synora/design-system/components/Button';
import { Spinner } from '@synora/design-system/components/Spinner';
import { useUploadFile } from '@/lib/api/files';
import type { UploadFileResponse } from '@/lib/api/files';

interface FileUploadButtonProps {
  workspaceId: string;
  conversationId: string;
  maxSize?: number; // in bytes, default 100MB
  acceptedTypes?: string[];
  onFileUpload?: (file: UploadFileResponse) => void;
}

/**
 * Pure upload trigger: picks a file, validates size/type client-side,
 * uploads, reports the result upward. Listing the conversation's
 * files is the container's job (ConversationFilesPanel) — the upload
 * mutation already invalidates the file-list query, so the panel
 * refreshes on its own.
 */
export function FileUploadButton({
  workspaceId,
  conversationId,
  maxSize = 100 * 1024 * 1024, // 100MB default — matches the backend multer limit
  acceptedTypes = ['*/*'],
  onFileUpload,
}: FileUploadButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { mutate: uploadFile, isPending } = useUploadFile(workspaceId, conversationId);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    // Validate file size
    if (file.size > maxSize) {
      setError(`File size exceeds ${maxSize / (1024 * 1024)}MB limit`);
      return;
    }

    // Validate file type if specified
    if (acceptedTypes[0] !== '*/*') {
      const isAccepted = acceptedTypes.some((type) => {
        if (type.endsWith('/*')) {
          const category = type.split('/')[0];
          return file.type.startsWith(category);
        }
        return file.type === type;
      });

      if (!isAccepted) {
        setError(`File type ${file.type} not allowed`);
        return;
      }
    }

    uploadFile(file, {
      onSuccess: (uploadedFile) => {
        onFileUpload?.(uploadedFile);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : 'Failed to upload file');
      },
    });
  };

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileSelect}
        disabled={isPending}
        className="hidden"
        accept={acceptedTypes.join(',')}
        aria-label="Choose a file to attach"
      />

      <Button
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={isPending}
        className="gap-2"
      >
        {isPending ? (
          <>
            <Spinner size="sm" />
            Uploading…
          </>
        ) : (
          <>
            <Paperclip className="h-4 w-4" />
            Attach file
          </>
        )}
      </Button>

      {error && (
        <div role="alert" className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
