'use client';

import React, { useRef } from 'react';
import { useUploadFile, useConversationFiles } from '@/lib/api/files';
import { Upload, File, Loader2, AlertCircle, Trash2 } from 'lucide-react';
import { useDeleteFile } from '@/lib/api/files';

interface FileUploadZoneProps {
  workspaceId: string;
  conversationId: string;
}

export function FileUploadZone({ workspaceId, conversationId }: FileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadFile(workspaceId, conversationId);
  const filesQuery = useConversationFiles(workspaceId, conversationId);
  const deleteFileMutation = useDeleteFile(workspaceId, conversationId);
  const [isDragging, setIsDragging] = React.useState(false);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    files.forEach((file) => {
      uploadMutation.mutate(file);
    });
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files || []);
    files.forEach((file) => {
      uploadMutation.mutate(file);
    });
  };

  const files = filesQuery.data || [];

  return (
    <div className="space-y-4">
      {/* Upload Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
          isDragging
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={handleSelect}
          className="hidden"
          accept=".pdf,.txt,.md,.json,.csv,.png,.jpg,.jpeg,.gif,.webp"
        />

        <Upload className="mx-auto h-12 w-12 text-gray-400 mb-2" />
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          Drag files here or click to browse
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Supported: PDF, images, text, code, markdown, CSV, JSON (max 100MB)
        </p>

        {uploadMutation.isPending && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm text-gray-600 dark:text-gray-400">Uploading...</span>
          </div>
        )}

        {uploadMutation.isError && (
          <div className="mt-4 text-sm text-red-600 dark:text-red-400 flex items-center justify-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {uploadMutation.error?.message || 'Upload failed'}
          </div>
        )}
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
            Files ({files.length})
          </h3>
          <div className="space-y-2">
            {files.map((file) => {
              const isImage = file.mimeType.startsWith('image/');
              return (
                <div
                  key={file.id}
                  className="flex items-start justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {isImage ? (
                      <img
                        src={`/files/${file.storageKey}`}
                        alt={file.fileName}
                        className="h-12 w-12 rounded object-cover flex-shrink-0"
                      />
                    ) : (
                      <File className="h-4 w-4 text-gray-400 flex-shrink-0 mt-1" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {file.fileName}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {(file.fileSize / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <button
                      onClick={() => deleteFileMutation.mutate(file.id)}
                      disabled={deleteFileMutation.isPending}
                      className="p-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded transition"
                      title="Delete file"
                      aria-label="Delete file"
                    >
                      <Trash2 className="h-4 w-4 text-gray-400 hover:text-red-500" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Loading state */}
      {filesQuery.isLoading && (
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-gray-600 dark:text-gray-400">Loading files...</span>
        </div>
      )}

      {/* Error state */}
      {filesQuery.isError && (
        <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Failed to load files
        </div>
      )}
    </div>
  );
}
