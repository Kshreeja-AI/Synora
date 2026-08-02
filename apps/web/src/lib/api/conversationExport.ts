import { getApiBaseUrl } from './client';

export type ConversationExportFormat = 'json' | 'markdown';

/**
 * Absolute URL for downloading a conversation export. Targets the
 * backend origin (a relative path would resolve against the Next.js
 * server, which has no such route). Auth rides on the accessToken
 * cookie, which the browser attaches automatically on same-site
 * top-level navigations — i.e. clicking a download link.
 */
export function getConversationExportUrl(
  workspaceId: string,
  conversationId: string,
  format: ConversationExportFormat
): string {
  return `${getApiBaseUrl()}/api/workspaces/${workspaceId}/conversations/${conversationId}/export?format=${format}`;
}
