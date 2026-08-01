'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { useConversation } from '@/lib/api/conversations';
import { api } from '@/lib/api/client';
import { Button } from '@synora/design-system/components/Button';
import { Input } from '@synora/design-system/components/Input';
import { Spinner } from '@synora/design-system/components/Spinner';
import { AlertCircle, Send, Plus } from 'lucide-react';

interface ConversationMessage {
  id: string;
  content: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  createdAt: string;
  inputTokens?: number;
  outputTokens?: number;
}

export default function ConversationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userQuery = useCurrentUser();
  const { currentWorkspace } = useCurrentWorkspace();

  const conversationId = params.id as string;
  const workspaceId = currentWorkspace?.id || '';

  const {
    data: conversation,
    isLoading: conversationLoading,
    error: conversationError,
  } = useConversation(workspaceId, conversationId, { enabled: !!workspaceId && !!conversationId });

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Fetch messages on conversation load
  useEffect(() => {
    if (!conversationId || !workspaceId) return;

    const fetchMessages = async () => {
      try {
        setIsLoadingMessages(true);
        setError(null);

        const response = await api.get<{ items: ConversationMessage[] }>(
          `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`
        );

        setMessages(response.items || []);
      } catch (err) {
        console.error('Failed to fetch messages', err);
        setError(err instanceof Error ? err.message : 'Failed to load messages');
      } finally {
        setIsLoadingMessages(false);
      }
    };

    fetchMessages();
  }, [conversationId, workspaceId]);

  // Setup SSE streaming for new messages
  const subscribeToStream = useCallback(
    (messageId: string) => {
      const streamUrl = `/api/workspaces/${workspaceId}/conversations/${conversationId}/stream?messageId=${messageId}`;

      const eventSource = new EventSource(streamUrl);
      eventSourceRef.current = eventSource;

      let streamedContent = '';

      eventSource.addEventListener('token', (e) => {
        try {
          const token = JSON.parse(e.data);
          streamedContent += token.content || '';

          setMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.id === messageId) {
              lastMsg.content = streamedContent;
            }
            return updated;
          });
        } catch (err) {
          console.error('Failed to parse stream token', err);
        }
      });

      eventSource.addEventListener('done', (e) => {
        try {
          const data = JSON.parse(e.data);

          setMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.id === messageId) {
              lastMsg.outputTokens = data.outputTokens;
              lastMsg.inputTokens = data.inputTokens;
            }
            return updated;
          });

          eventSource.close();
          eventSourceRef.current = null;
          setIsSending(false);
        } catch (err) {
          console.error('Failed to parse stream completion', err);
        }
      });

      eventSource.addEventListener('error', () => {
        console.error('Stream error', { messageId });
        setError('Connection lost while streaming response');
        eventSource.close();
        eventSourceRef.current = null;
        setIsSending(false);
      });
    },
    [workspaceId, conversationId]
  );

  // Send message
  const handleSendMessage = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!inputValue.trim() || !workspaceId || !conversationId) {
        return;
      }

      try {
        setIsSending(true);
        setError(null);

        // Add user message to UI immediately
        const userMessage: ConversationMessage = {
          id: `temp-${Date.now()}`,
          content: inputValue,
          role: 'USER',
          createdAt: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, userMessage]);
        const sentContent = inputValue;
        setInputValue('');

        // Send to backend
        const response = await api.post<{ id: string }>(
          `/api/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
          {
            content: sentContent,
            role: 'USER',
          }
        );

        // Replace temp message with real one
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === userMessage.id
              ? {
                  ...msg,
                  id: response.id,
                  createdAt: new Date().toISOString(),
                }
              : msg
          )
        );

        // Create placeholder for assistant message
        const assistantMessageId = `assist-${Date.now()}`;
        const assistantMessage: ConversationMessage = {
          id: assistantMessageId,
          content: '',
          role: 'ASSISTANT',
          createdAt: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, assistantMessage]);

        // Subscribe to stream for assistant response
        subscribeToStream(assistantMessageId);
      } catch (err) {
        console.error('Failed to send message', err);
        setError(err instanceof Error ? err.message : 'Failed to send message');
        setIsSending(false);
      }
    },
    [inputValue, workspaceId, conversationId, subscribeToStream]
  );

  // Cleanup event source on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  if (!userQuery.data || !currentWorkspace) {
    router.push('/auth/login');
    return null;
  }

  if (conversationLoading || isLoadingMessages) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner />
      </div>
    );
  }

  if (conversationError || !conversation) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
          <h2 className="text-lg font-semibold mb-2">Error</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {conversationError instanceof Error ? conversationError.message : 'Conversation not found'}
          </p>
          <Button onClick={() => router.push('/conversations')} className="mt-4">
            Back to Conversations
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="px-6 py-4">
          <h1 className="text-xl font-semibold text-foreground">{conversation.title}</h1>
          {conversation.description && (
            <p className="text-sm text-muted-foreground mt-1">{conversation.description}</p>
          )}
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span>
              Provider: <span className="font-medium">{conversation.provider}</span>
            </span>
            <span>
              Model: <span className="font-medium">{conversation.model}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center">
            <div>
              <Plus className="mx-auto mb-4 h-12 w-12 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">Start a conversation by sending a message</p>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === 'USER' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-2xl px-4 py-3 rounded-lg ${
                  message.role === 'USER'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground border border-border'
                }`}
              >
                <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                {message.role === 'ASSISTANT' && (message.inputTokens || message.outputTokens) && (
                  <p className="text-xs opacity-70 mt-2">
                    {message.inputTokens} input • {message.outputTokens} output
                  </p>
                )}
              </div>
            </div>
          ))
        )}

        {isSending && messages[messages.length - 1]?.role === 'ASSISTANT' && !messages[messages.length - 1]?.content && (
          <div className="flex justify-start">
            <div className="bg-muted text-foreground border border-border px-4 py-3 rounded-lg">
              <div className="flex gap-1">
                <span className="inline-block w-2 h-2 bg-current rounded-full animate-bounce"></span>
                <span
                  className="inline-block w-2 h-2 bg-current rounded-full animate-bounce"
                  style={{ animationDelay: '0.2s' }}
                ></span>
                <span
                  className="inline-block w-2 h-2 bg-current rounded-full animate-bounce"
                  style={{ animationDelay: '0.4s' }}
                ></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border bg-card p-6">
        <form onSubmit={handleSendMessage} className="flex gap-3">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type your message..."
            disabled={isSending}
            className="flex-1"
            autoFocus
          />
          <Button type="submit" disabled={isSending || !inputValue.trim()} className="gap-2">
            <Send className="h-4 w-4" />
            Send
          </Button>
        </form>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>
    </div>
  );
}
