'use client';

/**
 * Public read-only view of a shared conversation.
 *
 * Anyone with the link lands here — no auth, no dashboard shell. The
 * data comes from GET /api/shared/:token, which only resolves public,
 * unexpired shares and only returns public-safe fields, so this page
 * renders exactly what an anonymous viewer is allowed to see and
 * nothing else.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, MessageSquare, Sparkles, User, Info } from 'lucide-react';
import { Spinner } from '@synora/design-system/components/Spinner';
import { Markdown } from '@/components/chat/Markdown';
import {
  getSharedConversation,
  type PublicSharedConversation,
} from '@/lib/api/sharing';

const ROLE_ICON = {
  USER: User,
  ASSISTANT: Sparkles,
  SYSTEM: Info,
} as const;

export default function SharedConversationPage() {
  const params = useParams();
  const token = params.token as string;

  const [data, setData] = useState<PublicSharedConversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    getSharedConversation(token)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        // The backend intentionally returns a uniform 404 for missing,
        // private, and expired shares — mirror that vagueness here.
        if (!cancelled) setError('This shared conversation is unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h1 className="mb-2 text-lg font-semibold text-foreground">
            Conversation unavailable
          </h1>
          <p className="mb-6 max-w-sm text-sm text-muted-foreground">
            This link may have expired or been revoked. Ask the person who shared
            it for a new one.
          </p>
          <Link href="/" className="text-sm font-medium text-primary hover:underline">
            Go to Synora
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-foreground">
              {data.conversation.title}
            </h1>
            {data.conversation.description && (
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {data.conversation.description}
              </p>
            )}
          </div>
          <Link
            href="/"
            className="ml-4 shrink-0 text-sm font-medium text-primary hover:underline"
          >
            Synora
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <p className="text-xs text-muted-foreground">
          Shared conversation · read-only
        </p>

        {data.messages.length === 0 ? (
          <div className="py-16 text-center">
            <MessageSquare className="mx-auto mb-3 h-10 w-10 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">This conversation has no messages.</p>
          </div>
        ) : (
          data.messages.map((message) => {
            const isUser = message.role === 'USER';
            const Icon = ROLE_ICON[message.role] ?? Info;
            return (
              <div
                key={message.id}
                className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                data-testid="shared-message"
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
                <div
                  className={`min-w-0 max-w-2xl rounded-lg px-4 py-3 ${
                    isUser
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-muted text-foreground'
                  }`}
                >
                  {isUser ? (
                    <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                  ) : (
                    <Markdown className="text-sm">{message.content}</Markdown>
                  )}
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
