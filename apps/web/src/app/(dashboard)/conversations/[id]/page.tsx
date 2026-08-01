'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { useConversation } from '@/lib/api/conversations';
import { useMessages, useSendMessage, subscribeToMessageStream } from '@/lib/api/messages';
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
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Fetch messages using the hook
  const {
    data: messagesData,
    isLoading: isLoadingMessages,
    error: messagesError,
  } = useMessages(workspaceId, conversationId, { enabled: !!workspaceId && !!conversationId });

  // Send message mutation
  const { mutate: sendMessage } = useSendMessage(workspaceId, conversationId);

  // Scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Update messages when hook data changes
  useEffect(() => {
    if (messagesData) {
      setMessages(messagesData);
    }
  }, [messagesData]);

  // Handle message loading errors
  useEffect(() => {
    if (messagesError) {
      setError(messagesError instanceof Error ? messagesError.message : 'Failed to load messages');
    }
  }, [messagesError]);

  // Setup SSE streaming for new messages
  const subscribeToStream = useCallback(
    (messageId: string) => {
      let streamedContent = '';

      const unsubscribe = subscribeToMessageStream(
        workspaceId,
        conversationId,
        messageId,
        (token) => {
          streamedContent += token;
          setMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.id === messageId) {
              lastMsg.content = streamedContent;
            }
            return updated;
          });
        },
        (data) => {
          setMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.id === messageId) {
              lastMsg.outputTokens = data.outputTokens;
              lastMsg.inputTokens = data.inputTokens;
            }
            return updated;
          });
          setIsSending(false);
          unsubscribeRef.current = null;
        },
        (err) => {
          console.error('Stream error', { messageId });
          setError(err);
          setIsSending(false);
          unsubscribeRef.current = null;
        }
      );

      unsubscribeRef.current = unsubscribe;
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

      setIsSending(true);
      setError(null);
      const sentContent = inputValue;
      setInputValue('');

      // Add user message to UI immediately
      const tempUserMessageId = `temp-${Date.now()}`;
      const userMessage: ConversationMessage = {
        id: tempUserMessageId,
        content: sentContent,
        role: 'USER',
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage]);

      sendMessage(
        { content: sentContent, role: 'USER' },
        {
          onSuccess: (response) => {
            // Replace temp message with real one
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempUserMessageId
                  ? {
                      ...msg,
                      id: response.userMessage.id,
                      createdAt: response.userMessage.createdAt,
                    }
                  : msg
              )
            );

            // Add assistant placeholder message
            setMessages((prev) => [...prev, response.assistantMessage]);

            // Subscribe to stream for assistant response
            subscribeToStream(response.assistantMessage.id);
          },
          onError: (err) => {
            console.error('Failed to send message', err);
            setError(err instanceof Error ? err.message : 'Failed to send message');
            setIsSending(false);
            // Remove temp message on error
            setMessages((prev) => prev.filter((msg) => msg.id !== tempUserMessageId));
          },
        }
      );
    },
    [inputValue, workspaceId, conversationId, subscribeToStream, sendMessage]
  );

  // Cleanup event source on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
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
