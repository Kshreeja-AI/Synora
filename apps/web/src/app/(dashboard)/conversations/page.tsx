'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useConversationChat } from '@/hooks/useConversationChat';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { MessageList } from '@/components/chat/MessageList';
import { MessageInput } from '@/components/chat/MessageInput';
import { ConversationSidebar } from '@/components/conversations/ConversationSidebar';

/**
 * Main chat page for Release 3
 * Combines conversation list, messages, and streaming interface
 */
export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.workspaceId as string;
  const conversationId = params.conversationId as string | null;

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const chat = useConversationChat(workspaceId, conversationId || null);

  const handleSendMessage = async (content: string) => {
    await chat.sendMessage(content);
  };

  const handleCreateConversation = async () => {
    const newId = await chat.createNewConversation();
    router.push(`/conversations/${newId}`);
  };

  const handleSelectConversation = (id: string) => {
    router.push(`/conversations/${id}`);
  };

  return (
    <div className="flex h-screen bg-white dark:bg-slate-950">
      {/* Sidebar */}
      {sidebarOpen && (
        <div className="w-64 border-r border-slate-200 dark:border-slate-800 flex flex-col">
          <ConversationSidebar
            workspaceId={workspaceId}
            onCreateConversation={handleCreateConversation}
            onSelectConversation={handleSelectConversation}
          />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        {conversationId && (
          <ChatHeader
            conversation={chat.conversation}
            isLoading={chat.isLoadingConversation}
            selectedModel={chat.selectedModel}
            selectedProvider={chat.selectedProvider}
            temperature={chat.temperature}
            topP={chat.topP}
            contextWindow={chat.contextWindow}
            onModelChange={chat.setSelectedModel}
            onProviderChange={chat.setSelectedProvider}
            onTemperatureChange={chat.setTemperature}
            onTopPChange={chat.setTopP}
            onContextWindowChange={chat.setContextWindow}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          />
        )}

        {/* Messages */}
        {conversationId ? (
          <>
            <MessageList
              messages={chat.messages}
              isLoading={chat.isLoadingMessages}
              isStreaming={chat.isStreaming}
              streamContent={chat.streamContent}
              onLoadMore={chat.loadMoreMessages}
              hasMore={chat.hasMoreMessages}
            />

            {/* Input */}
            <MessageInput
              disabled={chat.isStreaming}
              onSend={handleSendMessage}
              onStop={chat.isStreaming ? chat.stopStreaming : undefined}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">
                No conversation selected
              </h2>
              <button
                onClick={handleCreateConversation}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                Start a new conversation
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
