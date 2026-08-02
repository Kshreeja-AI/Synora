'use client';

import { useState } from 'react';
import {
  Download,
  X,
  Image as ImageIcon,
  File,
  FileText,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import { ConversationFile } from '@/lib/api/files';

interface FilePreviewProps {
  file: ConversationFile;
  downloadUrl: string;
  onDelete?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * One row in the conversation's attachment list. Reflects the file's
 * pipeline state honestly:
 * - INFECTED → download hidden entirely (the backend also refuses
 *   with 403; hiding the control just keeps the UI truthful).
 * - PENDING/PROCESSING scan → download works, with a subtle spinner
 *   showing the scan hasn't finished.
 * Image thumbnailing is attempted only for clean image files.
 */
export function FilePreview({ file, downloadUrl, onDelete }: FilePreviewProps) {
  const [isImageError, setIsImageError] = useState(false);

  const isInfected = file.virusScanStatus === 'INFECTED';
  const isScanning = file.virusScanStatus === 'PENDING';
  const isImage = file.mimeType.startsWith('image/');
  const isText = file.mimeType.startsWith('text/') || file.mimeType === 'application/json';

  const getFileIcon = () => {
    if (isInfected) return <ShieldAlert className="h-4 w-4 text-destructive" />;
    if (isImage) return <ImageIcon className="h-4 w-4" />;
    if (isText) return <FileText className="h-4 w-4" />;
    return <File className="h-4 w-4" />;
  };

  return (
    <div className="bg-muted rounded-lg border border-border p-3">
      {isImage && !isInfected && !isImageError ? (
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
        // File info row
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {getFileIcon()}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate text-foreground">
                {file.fileName}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatFileSize(file.fileSize)}
                {isInfected && (
                  <span className="ml-2 text-destructive font-medium">
                    Blocked by security scan
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isScanning && (
              <span
                className="p-1.5 text-muted-foreground"
                title="Security scan in progress"
                role="status"
                aria-label="Security scan in progress"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
            )}
            {!isInfected && (
              <a
                href={downloadUrl}
                download={file.fileName}
                className="p-1.5 rounded hover:bg-accent transition"
                title="Download file"
                aria-label={`Download ${file.fileName}`}
              >
                <Download className="h-4 w-4" />
              </a>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="p-1.5 rounded hover:bg-destructive/10 transition"
                title="Delete file"
                aria-label={`Delete ${file.fileName}`}
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
