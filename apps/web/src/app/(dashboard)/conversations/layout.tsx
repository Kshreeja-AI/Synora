import { ReactNode } from 'react';
import { ConversationSidebar } from '@/components/conversations/ConversationSidebar';

export default function ConversationsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <ConversationSidebar />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
