'use client';

import { useState } from 'react';
import { Button } from '@synora/design-system/components/Button';
import { Spinner } from '@synora/design-system/components/Spinner';

interface MessageEditorProps {
  initialContent: string;
  isLoading: boolean;
  onSave: (content: string) => void;
  onCancel: () => void;
  onRegenerate?: (content: string) => void;
}

export function MessageEditor({
  initialContent,
  isLoading,
  onSave,
  onCancel,
  onRegenerate,
}: MessageEditorProps) {
  const [content, setContent] = useState(initialContent);

  const handleSave = () => {
    if (content.trim()) {
      onSave(content);
    }
  };

  const handleRegenerate = () => {
    if (onRegenerate && content.trim()) {
      onRegenerate(content);
    }
  };

  const hasChanges = content !== initialContent;

  return (
    <div className="space-y-3 bg-muted p-3 rounded-lg border border-border">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={isLoading}
        className="w-full min-h-[100px] p-2 rounded border border-input bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
        placeholder="Edit message..."
      />

      <div className="flex gap-2 justify-end">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
          size="sm"
        >
          Cancel
        </Button>

        <Button
          variant="outline"
          onClick={handleSave}
          disabled={isLoading || !hasChanges}
          size="sm"
        >
          {isLoading ? (
            <>
              <Spinner size="sm" />
              Saving...
            </>
          ) : (
            'Save'
          )}
        </Button>

        {onRegenerate && (
          <Button
            onClick={handleRegenerate}
            disabled={isLoading || !hasChanges}
            size="sm"
          >
            {isLoading ? (
              <>
                <Spinner size="sm" />
                Regenerating...
              </>
            ) : (
              'Save & Regenerate'
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
