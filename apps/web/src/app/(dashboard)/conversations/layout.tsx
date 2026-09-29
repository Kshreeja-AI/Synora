import { ReactNode } from 'react';
import { ConversationSidebar } from '@/components/conversations/ConversationSidebar';

export default function ConversationsLayout({ children }: { children: ReactNode }) {
  // h-full, not h-screen: this renders inside AppShell's scroll
  // container, which already occupies the viewport below the topbar.
  return (
    <div className="flex h-full overflow-hidden">
      <ConversationSidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
