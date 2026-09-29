'use client';

import { useCallback, useState } from 'react';
import {
  Check,
  Copy,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
  User,
  Sparkles,
  Info,
} from 'lucide-react';
import { Markdown } from './Markdown';
import { FeedbackControls } from './FeedbackControls';
import { SaveAsDocument } from '@/components/documents/SaveAsDocument';
import { MessageAttachments } from './MessageAttachments';
import { MessageEditor } from './MessageEditor';
import { ForkNavigator } from '@/components/branching/ForkNavigator';
import { CreateBranchButton } from '@/components/branching/CreateBranchButton';
import {
  useUpdateMessage,
  usePinMessage,
  useUnpinMessage,
  type ConversationMessage,
} from '@/lib/api/messages';

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
  /**
   * Called after this message's content has been successfully edited.
   * The container decides what follows — normally regenerating the
   * assistant reply underneath, since the turn it answered has changed.
   */
  onEdited?: (messageId: string, content: string) => void;
  /**
   * Offered follow-up instructions ("Make that simpler", …). Clicking one
   * calls this with the instruction TEXT — the container prefills the
   * composer with it, visibly, and the person sends it themselves.
   *
   * PREFILL, NEVER AUTO-SEND, is the design. The instruction is ordinary
   * words the person could have typed: putting them in the input box shows
   * exactly what will be asked, lets it be edited or discarded, spends
   * nothing until they press send — and quietly teaches that no magic was
   * involved, which is how the prompt burden actually goes away.
   *
   * Passed only for the LAST assistant message, by the container: a
   * follow-up speaks to the tail of the conversation, and offering it
   * under an old reply would imply a precision it does not have.
   */
  onFollowUp?: (instruction: string) => void;
  /**
   * The project this conversation is filed into, if any — forwarded to
   * the "Save as doc" affordance so a saved reply can be filed alongside
   * the thinking it came from (visibly, and optionally).
   */
  conversationProjectId?: string | null;
}

/**
 * Three, not ten. Each is a complete sentence in plain words — visible
 * proof there is no hidden layer — and a row of many chips is decision
 * fatigue wearing a helpful face.
 */
const FOLLOW_UPS: { label: string; instruction: string }[] = [
  { label: 'Simpler', instruction: 'Make that simpler — shorter sentences, no jargon.' },
  { label: 'More detail', instruction: 'Go deeper on that — expand the key points.' },
  { label: 'Shorter', instruction: 'Condense that to the essentials.' },
];

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
  onEdited,
  onFollowUp,
  conversationProjectId,
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
  // Feedback (thumbs + report) applies to completed assistant
  // responses only. User turns have nothing to rate against; system
  // turns are configuration, not model output; streaming messages are
  // still being generated.
  const showFeedback =
    branchingEnabled &&
    message.role === 'ASSISTANT' &&
    !isStreaming &&
    !!message.content;
  // Follow-up chips appear only where the container passed the callback —
  // i.e. under the last assistant reply — and only once that reply is
  // complete. A follow-up to half a response would read as a verdict on
  // words still arriving.
  const showFollowUps =
    !!onFollowUp && message.role === 'ASSISTANT' && !isStreaming && !!message.content;

  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isUser = message.role === 'USER';
  const isAssistant = message.role === 'ASSISTANT';
  const Icon = ROLE_ICON[message.role] ?? Info;

  const updateMessage = useUpdateMessage(workspaceId ?? '', conversationId ?? '', message.id);
  const pinMessage = usePinMessage(workspaceId ?? '', conversationId ?? '');
  const unpinMessage = useUnpinMessage(workspaceId ?? '', conversationId ?? '');

  // Editing is offered on user turns only. An assistant bubble holds
  // model output; letting a human rewrite it in place would leave the
  // transcript claiming the model said something it never said. To
  // change an assistant response you regenerate or branch it.
  const showEdit = branchingEnabled && isUser && !isStreaming && !!onEdited;
  const showPin = branchingEnabled && !isStreaming;
  const isPinBusy = pinMessage.isPending || unpinMessage.isPending;

  const handleSaveEdit = useCallback(
    (content: string) => {
      setActionError(null);
      updateMessage.mutate(
        { content },
        {
          onSuccess: () => {
            setIsEditing(false);
            onEdited?.(message.id, content);
          },
          onError: (err) =>
            setActionError(err instanceof Error ? err.message : 'Failed to save changes'),
        }
      );
    },
    [updateMessage, onEdited, message.id]
  );

  const handleTogglePin = useCallback(() => {
    setActionError(null);
    const mutation = message.isPinned ? unpinMessage : pinMessage;
    mutation.mutate(message.id, {
      onError: (err) =>
        setActionError(err instanceof Error ? err.message : 'Failed to update pin'),
    });
  }, [message.isPinned, message.id, pinMessage, unpinMessage]);

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
        {message.isPinned && (
          <span className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Pin className="h-3 w-3" aria-hidden />
            Pinned
          </span>
        )}

        {isEditing ? (
          <div className="w-full">
            <MessageEditor
              initialContent={message.content}
              isLoading={updateMessage.isPending}
              onSave={handleSaveEdit}
              onCancel={() => {
                setIsEditing(false);
                setActionError(null);
              }}
            />
          </div>
        ) : (
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

          {message.attachments && message.attachments.length > 0 && (
            <MessageAttachments attachments={message.attachments} />
          )}
        </div>
        )}

        {actionError && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {actionError}
          </p>
        )}

        {showFollowUps && (
          // Always visible, unlike the hover action row below: these exist
          // to be discovered by people who would never think to hover.
          // Clicking one PREFILLS the composer — nothing is sent.
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FOLLOW_UPS.map(({ label, instruction }) => (
              <button
                key={label}
                type="button"
                onClick={() => onFollowUp!(instruction)}
                title={instruction}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {label}
              </button>
            ))}
          </div>
        )}

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

          {showEdit && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
              aria-label="Edit message"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          )}

          {showPin && (
            <button
              type="button"
              onClick={handleTogglePin}
              disabled={isPinBusy}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground disabled:opacity-50"
              aria-label={message.isPinned ? 'Unpin message' : 'Pin message'}
            >
              {message.isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              {message.isPinned ? 'Unpin' : 'Pin'}
            </button>
          )}

          {isAssistant && !isStreaming && !!message.content && (
            // A good reply should not have to die in the transcript.
            <SaveAsDocument content={message.content} projectId={conversationProjectId} />
          )}

          {showFeedback && (
            <FeedbackControls
              workspaceId={workspaceId!}
              conversationId={conversationId!}
              messageId={message.id}
              messageContent={message.content}
            />
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
