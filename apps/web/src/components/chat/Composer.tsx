'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Send, Square } from 'lucide-react';
import { Button } from '@synora/design-system/components/Button';

const MAX_TEXTAREA_HEIGHT = 200;

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  isGenerating?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Auto-growing chat composer. Enter sends, Shift+Enter inserts a newline.
 * While a response is generating the send button becomes a stop button.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  isGenerating = false,
  disabled = false,
  placeholder = 'Send a message…',
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow the textarea to fit content, capped so the message list keeps space.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (value.trim() && !isGenerating && !disabled) {
          onSubmit();
        }
      }
    },
    [value, isGenerating, disabled, onSubmit]
  );

  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (value.trim() && !isGenerating && !disabled) {
        onSubmit();
      }
    },
    [value, isGenerating, disabled, onSubmit]
  );

  return (
    <form onSubmit={handleFormSubmit} className="flex items-end gap-3">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        aria-label="Message input"
        className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />

      {isGenerating && onStop ? (
        <Button type="button" onClick={onStop} variant="outline" className="gap-2">
          <Square className="h-4 w-4" />
          Stop
        </Button>
      ) : (
        <Button type="submit" disabled={disabled || isGenerating || !value.trim()} className="gap-2">
          <Send className="h-4 w-4" />
          Send
        </Button>
      )}
    </form>
  );
}
