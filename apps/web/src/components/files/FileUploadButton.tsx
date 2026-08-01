'use client';

import { useState, useRef } from 'react';
import { Button } from '@synora/design-system/components/Button';
import { Spinner } from '@synora/design-system/components/Spinner';
import { useUploadFile } from '@/lib/api/files';
import { Upload, AlertCircle } from 'lucide-react';

interface FileUploadButtonProps {
  workspaceId: string;
  conversationId: string;
  maxSize?: number;
  acceptedTypes?: string[];
}

export function FileUploadButton({
  workspaceId,
  conversationId,
  maxSize = 100 * 1024 * 1024,
  acceptedTypes = ['image/*', 'application/pdf', 'text/plain', 'application/json'],
}: FileUploadButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { mutate: uploadFile, isPending } = useUploadFile(workspaceId, conversationId);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    setError(null);

    if (file.size > maxSize) {
      setError(`File size exceeds ${maxSize / 1024 / 1024}MB limit`);
      return;
    }

    uploadFile(file, {
      onError: (err) => {
        setError(err.message || 'Failed to upload file');
      },
      onSuccess: () => {
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      },
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileSelect}
        accept={acceptedTypes.join(',')}
        className="hidden"
        disabled={isPending}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
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
      {error && (
        <div className="flex gap-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
