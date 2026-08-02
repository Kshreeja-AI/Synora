'use client';

import { useCallback, useState } from 'react';
import { Check, Copy, RefreshCw, Trash2, User, Sparkles, Info } from 'lucide-react';
import { Markdown } from './Markdown';
import { ForkNavigator } from '@/components/branching/ForkNavigator';
import { CreateBranchButton } from '@/components/branching/CreateBranchButton';
import type { ConversationMessage } from '@/lib/api/messages';

interface MessageBubbleProps {
  message: ConversationMessage;
  isStreaming?: boolean;
  onRegenerate?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  /**
   * Workspace + conversation context, required for branch controls.
   * When omitted, branch controls are hidden — safe for detached
   * contexts (e.g. isolated component tests) that don't wire branching.
   */
  workspaceId?: string;
  conversationId?: string;
  /**
   * Called with the id of a newly-created sibling. The container is
   * expected to enqueue a generation for it (i.e. treat it like a
   * regenerate) so the fork isn't left as an empty message.
   */
  onBranchCreated?: (newMessageId: string) => void;
}

const ROLE_ICON = {
  USER: User,
  ASSISTANT: Sparkles,
  SYSTEM: Info,
} as const;

export function MessageBubble({
  message,
  isStreaming = false,
  onRegenerate,
  onDelete,
  workspaceId,
  conversationId,
  onBranchCreated,
}: MessageBubbleProps) {
  const branchingEnabled = Boolean(workspaceId && conversationId);
  const showFork = branchingEnabled && (message.siblingCount ?? 1) > 1;
  // Only expose "branch" on completed assistant messages that have a
  // parent (i.e. they're a reply to a user turn). Streaming messages
  // are still in flight; user/system turns don't fork meaningfully at
  // this UI level (that's a "regenerate" of the assistant response
  // that follows them, which lives on the assistant bubble).
  const showBranchButton =
    branchingEnabled &&
    message.role === 'ASSISTANT' &&
    !isStreaming &&
    !!message.parentId;

  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'USER';
  const isAssistant = message.role === 'ASSISTANT';
  const Icon = ROLE_ICON[message.role] ?? Info;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — nothing actionable for the user here.
    }
  }, [message.content]);

  const hasTokens = Boolean(message.inputTokens || message.outputTokens);

  return (
    <div
      className={`group flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      data-testid="message"
      data-role={message.role}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
        }`}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className={`flex min-w-0 max-w-2xl flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`w-full rounded-lg px-4 py-3 ${
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'border border-border bg-muted text-foreground'
          }`}
        >
          {message.content ? (
            isUser ? (
              <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
            ) : (
              <Markdown className="text-sm">{message.content}</Markdown>
            )
          ) : isStreaming ? (
            <div className="flex gap-1 py-1" role="status" aria-label="Generating response">
              <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-current" />
              <span
                className="inline-block h-2 w-2 animate-bounce rounded-full bg-current"
                style={{ animationDelay: '0.2s' }}
              />
              <span
                className="inline-block h-2 w-2 animate-bounce rounded-full bg-current"
                style={{ animationDelay: '0.4s' }}
              />
            </div>
          ) : (
            <p className="text-sm italic opacity-60">No content</p>
          )}
        </div>

        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
            aria-label="Copy message"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>

          {isAssistant && onRegenerate && !isStreaming && (
            <button
              type="button"
              onClick={() => onRegenerate(message.id)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
              aria-label="Regenerate response"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          )}

          {showBranchButton && (
            <CreateBranchButton
              workspaceId={workspaceId!}
              conversationId={conversationId!}
              parentId={message.parentId!}
              onBranchCreated={onBranchCreated}
            />
          )}

          {onDelete && !isStreaming && (
            <button
              type="button"
              onClick={() => onDelete(message.id)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-destructive"
              aria-label="Delete message"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          )}

          {showFork && (
            <ForkNavigator
              workspaceId={workspaceId!}
              conversationId={conversationId!}
              messageId={message.id}
              parentId={message.parentId}
              siblingIndex={message.siblingIndex}
              siblingCount={message.siblingCount}
            />
          )}

          {hasTokens && (
            <span className="ml-auto tabular-nums">
              {message.inputTokens ?? 0} in · {message.outputTokens ?? 0} out
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
