/**
 * SSE streaming hook for real-time token accumulation
 * Subscribes to EventSource, accumulates tokens, manages lifecycle
 */

import { useEffect, useRef, useState } from 'react';

export interface UseStreamResult {
  content: string;
  isStreaming: boolean;
  error: string | null;
  close: () => void;
}

/**
 * Hook: Subscribe to SSE EventSource and accumulate tokens in real-time
 * @param eventSource - EventSource instance (or null to skip subscription)
 * @param onToken - Optional callback fired on each token
 * @returns { content, isStreaming, error, close }
 */
export function useStream(
  eventSource: EventSource | null,
  onToken?: (token: string) => void
): UseStreamResult {
  const [content, setContent] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<EventSource | null>(eventSource);

  useEffect(() => {
    if (!eventSource) return;

    streamRef.current = eventSource;
    setIsStreaming(true);
    setError(null);
    setContent('');

    const handleToken = (e: MessageEvent) => {
      try {
        const token = JSON.parse(e.data);
        setContent((prev) => prev + token);
        onToken?.(token);
      } catch (err) {
        console.error('Failed to parse token:', err);
      }
    };

    const handleDone = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        console.debug('Stream complete:', data);
      } catch (err) {
        console.error('Failed to parse completion data:', err);
      }
      setIsStreaming(false);
      eventSource.close();
      streamRef.current = null;
    };

    const handleError = (e: Event) => {
      console.error('Stream error:', e);
      setError('Stream connection failed');
      setIsStreaming(false);
      eventSource.close();
      streamRef.current = null;
    };

    eventSource.addEventListener('token', handleToken);
    eventSource.addEventListener('done', handleDone);
    eventSource.addEventListener('error', handleError);

    return () => {
      eventSource.removeEventListener('token', handleToken);
      eventSource.removeEventListener('done', handleDone);
      eventSource.removeEventListener('error', handleError);
      if (eventSource.readyState !== EventSource.CLOSED) {
        eventSource.close();
      }
      streamRef.current = null;
    };
  }, [eventSource, onToken]);

  const close = () => {
    if (streamRef.current && streamRef.current.readyState !== EventSource.CLOSED) {
      streamRef.current.close();
    }
    setIsStreaming(false);
    streamRef.current = null;
  };

  return { content, isStreaming, error, close };
}
