'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { useConversation } from '@/lib/api/conversations';
import {
  useMessages,
  useSendMessage,
  useRegenerateMessage,
  useCancelGeneration,
  useDeleteMessage,
  subscribeToMessageStream,
  type ConversationMessage,
} from '@/lib/api/messages';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { Composer } from '@/components/chat/Composer';
import { ConversationFilesPanel } from '@/components/files/ConversationFilesPanel';
import { ShareDialog } from '@/components/sharing/ShareDialog';
import { FileIntoProject } from '@/components/projects/FileIntoProject';
import { ConversationExport } from '@/components/history/ConversationExport';
import { PresenceIndicator } from '@/components/collaboration/PresenceIndicator';
import { TypingIndicator } from '@/components/collaboration/TypingIndicator';
import { useTypingBroadcast } from '@/lib/api/collaboration';
import { Share2 } from 'lucide-react';
import { Button } from '@synora/design-system/components/Button';
import { Spinner } from '@synora/design-system/components/Spinner';
import { AlertCircle, MessageSquarePlus } from 'lucide-react';

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

  const {
    data: messagesData,
    isLoading: isLoadingMessages,
    error: messagesError,
  } = useMessages(workspaceId, conversationId, { enabled: !!workspaceId && !!conversationId });

  const { mutate: sendMessage } = useSendMessage(workspaceId, conversationId);
  const { mutate: regenerate } = useRegenerateMessage(workspaceId, conversationId);
  const { mutate: cancelGeneration } = useCancelGeneration(workspaceId, conversationId);
  const { mutate: deleteMessage } = useDeleteMessage(workspaceId, conversationId);
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const { notifyTyping } = useTypingBroadcast(conversationId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (messagesData) setMessages(messagesData);
  }, [messagesData]);

  useEffect(() => {
    if (messagesError) {
      setError(messagesError instanceof Error ? messagesError.message : 'Failed to load messages');
    }
  }, [messagesError]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const patchMessage = useCallback(
    (messageId: string, patch: Partial<ConversationMessage>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, ...patch } : m))
      );
    },
    []
  );

  const startStream = useCallback(
    (messageId: string) => {
      let streamed = '';
      setStreamingId(messageId);

      unsubscribeRef.current = subscribeToMessageStream(
        workspaceId,
        conversationId,
        messageId,
        (token) => {
          streamed += token;
          patchMessage(messageId, { content: streamed });
        },
        (data) => {
          patchMessage(messageId, {
            inputTokens: data.inputTokens,
            outputTokens: data.outputTokens,
          });
          setStreamingId(null);
          unsubscribeRef.current = null;
        },
        (err) => {
          setError(err);
          setStreamingId(null);
          unsubscribeRef.current = null;
        }
      );
    },
    [workspaceId, conversationId, patchMessage]
  );

  const handleSend = useCallback(() => {
    const content = inputValue.trim();
    if (!content || !workspaceId || !conversationId) return;

    setError(null);
    setInputValue('');

    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, content, role: 'USER', createdAt: new Date().toISOString() },
    ]);

    sendMessage(
      { content, role: 'USER' },
      {
        onSuccess: (response) => {
          setMessages((prev) => [
            ...prev.map((m) => (m.id === tempId ? response.userMessage : m)),
            response.assistantMessage,
          ]);
          startStream(response.assistantMessage.id);
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Failed to send message');
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          setInputValue(content);
        },
      }
    );
  }, [inputValue, workspaceId, conversationId, sendMessage, startStream]);

  const handleRegenerate = useCallback(
    (messageId: string) => {
      setError(null);
      patchMessage(messageId, { content: '', inputTokens: 0, outputTokens: 0 });
      regenerate(messageId, {
        onSuccess: () => startStream(messageId),
        onError: (err) =>
          setError(err instanceof Error ? err.message : 'Failed to regenerate response'),
      });
    },
    [regenerate, startStream, patchMessage]
  );

  const handleStop = useCallback(() => {
    if (!streamingId) return;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    cancelGeneration(streamingId);
    setStreamingId(null);
  }, [streamingId, cancelGeneration]);

  const handleDelete = useCallback(
    (messageId: string) => {
      const previous = messages;
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      deleteMessage(messageId, {
        onError: (err) => {
          setMessages(previous);
          setError(err instanceof Error ? err.message : 'Failed to delete message');
        },
      });
    },
    [messages, deleteMessage]
  );

  // A newly-created branch is an empty assistant sibling. Reuse the
  // existing regenerate path to enqueue a generation job for it and
  // stream its tokens, then invalidate the linearized message list so
  // the fork indicator picks up the new sibling.
  const handleBranchCreated = useCallback(
    (newMessageId: string) => {
      setError(null);
      regenerate(newMessageId, {
        onSuccess: () => {
          startStream(newMessageId);
          queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
        },
        onError: (err) =>
          setError(
            err instanceof Error ? err.message : 'Failed to generate branch response'
          ),
      });
    },
    [regenerate, startStream, queryClient, conversationId]
  );

  // Editing a user turn invalidates the assistant reply that answered
  // it, so the reply is regenerated against the new text. If the edited
  // message has no assistant reply after it (the user edited the last
  // turn before sending), there is nothing to regenerate.
  const handleEdited = useCallback(
    (messageId: string, content: string) => {
      setError(null);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content } : m)));

      const index = messages.findIndex((m) => m.id === messageId);
      const reply = index >= 0 ? messages[index + 1] : undefined;
      if (!reply || reply.role !== 'ASSISTANT') return;

      handleRegenerate(reply.id);
    },
    [messages, handleRegenerate]
  );

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
    };
  }, []);

  // Follow-up chips live under the LAST assistant reply only — a
  // follow-up speaks to the tail of the conversation. Clicking one
  // prefills the composer (visible, editable, discardable); it never
  // sends. Deliberately not routed through notifyTyping: the person
  // hasn't typed anything yet.
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'ASSISTANT')?.id;
  const handleFollowUp = useCallback((instruction: string) => {
    setInputValue(instruction);
  }, []);

  if (!userQuery.isLoading && !userQuery.data) {
    router.push('/auth/login');
    return null;
  }

  if (conversationLoading || isLoadingMessages || userQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (conversationError || !conversation) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-destructive" />
          <h2 className="mb-2 text-lg font-semibold">Conversation unavailable</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {conversationError instanceof Error
              ? conversationError.message
              : 'This conversation could not be found.'}
          </p>
          <Button onClick={() => router.push('/conversations')}>Back to Conversations</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">{conversation.title}</h1>
            {conversation.description && (
              <p className="mt-1 text-sm text-muted-foreground">{conversation.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {/* Where this conversation belongs, stated and changeable in
                one control — so a thread of thinking can join the project
                it is actually about. */}
            <FileIntoProject
              workspaceId={workspaceId}
              conversationId={conversationId}
              projectId={conversation.projectId}
            />
            <PresenceIndicator workspaceId={workspaceId} conversationId={conversationId} />
            <ConversationExport workspaceId={workspaceId} conversationId={conversationId} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShareOpen(true)}
              className="gap-2"
            >
              <Share2 className="h-4 w-4" />
              Share
            </Button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            Provider: <span className="font-medium">{conversation.provider}</span>
          </span>
          <span>
            Model: <span className="font-medium">{conversation.model}</span>
          </span>
        </div>
      </header>

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        workspaceId={workspaceId}
        conversationId={conversationId}
        conversationTitle={conversation.title}
      />

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <MessageSquarePlus className="mx-auto mb-4 h-12 w-12 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">Start the conversation by sending a message</p>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isStreaming={streamingId === message.id}
              onRegenerate={handleRegenerate}
              onDelete={handleDelete}
              workspaceId={workspaceId}
              conversationId={conversationId}
              onBranchCreated={handleBranchCreated}
              onEdited={handleEdited}
              onFollowUp={message.id === lastAssistantId ? handleFollowUp : undefined}
              conversationProjectId={conversation.projectId}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <ConversationFilesPanel workspaceId={workspaceId} conversationId={conversationId} />

      <TypingIndicator workspaceId={workspaceId} conversationId={conversationId} />

      <div className="border-t border-border bg-card p-6">
        <Composer
          value={inputValue}
          onChange={(value) => {
            setInputValue(value);
            notifyTyping();
          }}
          onSubmit={handleSend}
          onStop={handleStop}
          isGenerating={streamingId !== null}
        />
        {error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
