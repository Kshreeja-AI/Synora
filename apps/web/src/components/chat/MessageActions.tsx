'use client';

import { useState } from 'react';
import {
  Copy,
  RefreshCw,
  Pin,
  PinOff,
  Trash2,
  MoreVertical,
} from 'lucide-react';
import { Button } from '@synora/design-system/components/Button';
import { ConversationMessage } from '@/lib/api/messages';

interface MessageActionsProps {
  message: ConversationMessage;
  isGenerating: boolean;
  isPinned?: boolean;
  onRegenerate?: () => void;
  onCopy?: () => void;
  onPin?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
}

export function MessageActions({
  message,
  isGenerating,
  isPinned = false,
  onRegenerate,
  onCopy,
  onPin,
  onDelete,
  onEdit,
}: MessageActionsProps) {
  const [isOpen, setIsOpen] = useState(false);

  const isAssistant = message.role === 'ASSISTANT';
  const isUser = message.role === 'USER';

  const handleCopy = () => {
    if (onCopy) {
      onCopy();
    } else {
      navigator.clipboard.writeText(message.content);
    }
    setIsOpen(false);
  };

  const handleRegenerate = () => {
    if (onRegenerate && isAssistant) {
      onRegenerate();
      setIsOpen(false);
    }
  };

  const handlePin = () => {
    if (onPin) {
      onPin();
      setIsOpen(false);
    }
  };

  const handleDelete = () => {
    if (onDelete) {
      if (confirm('Delete this message? This cannot be undone.')) {
        onDelete();
        setIsOpen(false);
      }
    }
  };

  const handleEdit = () => {
    if (onEdit && isUser) {
      onEdit();
      setIsOpen(false);
    }
  };

  return (
    <div className="relative inline-flex gap-1">
      {/* Quick action buttons (always visible) */}
      {isAssistant && onRegenerate && (
        <Button
          variant="ghost"
          size="sm"
          disabled={isGenerating}
          onClick={handleRegenerate}
          title="Regenerate response"
          className="h-8 w-8 p-0"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      )}

      {onCopy && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          title="Copy message"
          className="h-8 w-8 p-0"
        >
          <Copy className="h-4 w-4" />
        </Button>
      )}

      {/* More menu */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(!isOpen)}
          title="More options"
          className="h-8 w-8 p-0"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-48 rounded-lg border border-border bg-popover shadow-lg z-10">
            <div className="p-1 space-y-1">
              {isUser && onEdit && (
                <button
                  onClick={handleEdit}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent rounded transition"
                >
                  Edit message
                </button>
              )}

              {onPin && (
                <button
                  onClick={handlePin}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent rounded transition"
                >
                  {isPinned ? (
                    <>
                      <PinOff className="h-4 w-4" />
                      Unpin
                    </>
                  ) : (
                    <>
                      <Pin className="h-4 w-4" />
                      Pin
                    </>
                  )}
                </button>
              )}

              {onDelete && (
                <button
                  onClick={handleDelete}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded transition"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Click outside to close */}
      {isOpen && (
        <div
          className="fixed inset-0"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
