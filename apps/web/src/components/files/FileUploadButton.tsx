'use client';

import { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@synora/design-system/components/Button';
import { Spinner } from '@synora/design-system/components/Spinner';
import { useUploadFile } from '@/lib/api/files';
import { FilePreview } from './FilePreview';
import type { ConversationFile } from '@/lib/api/files';

interface FileUploadButtonProps {
  workspaceId: string;
  conversationId: string;
  maxSize?: number; // in bytes, default 100MB
  acceptedTypes?: string[];
  onFileUpload?: (file: ConversationFile) => void;
}

export function FileUploadButton({
  workspaceId,
  conversationId,
  maxSize = 100 * 1024 * 1024, // 100MB default
  acceptedTypes = ['*/*'],
  onFileUpload,
}: FileUploadButtonProps) {
  const [uploadedFiles, setUploadedFiles] = useState<ConversationFile[]>([]);
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
        setUploadedFiles((prev) => [...prev, uploadedFile]);
        onFileUpload?.(uploadedFile);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      },
      onError: (err) => {
        setError(
          err instanceof Error ? err.message : 'Failed to upload file'
        );
      },
    });
  };

  const handleRemoveFile = (fileId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  return (
    <div className="space-y-2">
      <div>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          disabled={isPending}
          className="hidden"
          accept={acceptedTypes.join(',')}
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
              Uploading...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              Upload File
            </>
          )}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {uploadedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Uploaded files ({uploadedFiles.length})
          </div>
          {uploadedFiles.map((file) => (
            <FilePreview
              key={file.id}
              file={file}
              downloadUrl={`/api/workspaces/${workspaceId}/conversations/${conversationId}/files/${file.id}/download`}
              onDelete={() => handleRemoveFile(file.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
