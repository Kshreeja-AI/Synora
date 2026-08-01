'use client';

import { useState } from 'react';
import { Download, X, Image as ImageIcon, File, FileText } from 'lucide-react';
import { ConversationFile } from '@/lib/api/files';

interface FilePreviewProps {
  file: ConversationFile;
  downloadUrl: string;
  onDelete?: () => void;
}

export function FilePreview({ file, downloadUrl, onDelete }: FilePreviewProps) {
  const [isImageError, setIsImageError] = useState(false);

  const isImage = file.mimeType.startsWith('image/');
  const isText = file.mimeType.startsWith('text/') || file.mimeType === 'application/json';
  const isCode = file.mimeType.includes('source') || file.mimeType.includes('script');

  const getFileIcon = () => {
    if (isImage) return <ImageIcon className="h-4 w-4" />;
    if (isText || isCode) return <FileText className="h-4 w-4" />;
    return <File className="h-4 w-4" />;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="bg-muted rounded-lg border border-border p-3">
      {isImage && !isImageError ? (
        // Image preview
        <div className="space-y-2">
          <img
            src={downloadUrl}
            alt={file.fileName}
            onError={() => setIsImageError(true)}
            className="max-w-sm max-h-48 rounded border border-border"
          />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">{file.fileName}</span>
            <span>{formatFileSize(file.fileSize)}</span>
          </div>
        </div>
      ) : (
        // File info with download
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {getFileIcon()}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate text-foreground">
                {file.fileName}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatFileSize(file.fileSize)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <a
              href={downloadUrl}
              download={file.fileName}
              className="p-1.5 rounded hover:bg-accent transition"
              title="Download file"
            >
              <Download className="h-4 w-4" />
            </a>
            {onDelete && (
              <button
                onClick={onDelete}
                className="p-1.5 rounded hover:bg-destructive/10 transition"
                title="Delete file"
              >
                <X className="h-4 w-4 text-destructive" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
