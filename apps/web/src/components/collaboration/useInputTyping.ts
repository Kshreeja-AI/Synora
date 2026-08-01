import { useCallback, useEffect, useRef } from 'react';

interface UseInputTypingOptions {
  broadcastTyping: (isTyping: boolean) => void;
  debounceMs?: number;
}

export function useInputTyping({
  broadcastTyping,
  debounceMs = 300,
}: UseInputTypingOptions) {
  const isTypingRef = useRef(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const broadcastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleInputChange = useCallback(() => {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      broadcastTyping(true);
      broadcastTimeoutRef.current = setTimeout(() => {
        if (isTypingRef.current) {
          broadcastTyping(true);
        }
      }, debounceMs);
    }

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      broadcastTyping(false);
    }, debounceMs);
  }, [broadcastTyping, debounceMs]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (broadcastTimeoutRef.current) {
        clearTimeout(broadcastTimeoutRef.current);
      }
    };
  }, []);

  return { handleInputChange };
}
