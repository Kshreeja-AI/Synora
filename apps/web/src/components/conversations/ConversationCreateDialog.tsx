'use client';

import { useState } from 'react';
import { X, Zap, Sparkles } from 'lucide-react';
import { PromptSelector } from './PromptSelector';
import { Button } from '@synora/design-system';
import { toast } from 'sonner';

interface ConversationCreateDialogProps {
  isOpen: boolean;
  workspaceId: string;
  isLoading?: boolean;
  onClose: () => void;
  onCreateBasic: (title: string) => Promise<void>;
  onCreateWithTemplate?: (template: { title: string; systemPrompt: string }) => Promise<void>;
  onCreateWithPrompt?: (prompt: { name: string; content: string }) => Promise<void>;
}

export function ConversationCreateDialog({
  isOpen,
  workspaceId,
  isLoading = false,
  onClose,
  onCreateBasic,
  onCreateWithTemplate,
  onCreateWithPrompt,
}: ConversationCreateDialogProps) {
  const [tab, setTab] = useState<'blank' | 'template' | 'prompt'>('blank');
  const [title, setTitle] = useState('');

  if (!isOpen) return null;

  const handleCreateBasic = async () => {
    if (!title.trim()) {
      toast.error('Please enter a conversation title');
      return;
    }
    try {
      await onCreateBasic(title);
      setTitle('');
      onClose();
    } catch {
      toast.error('Failed to create conversation');
    }
  };

  const handleSelectTemplate = async (template: { title: string; systemPrompt: string }) => {
    try {
      await onCreateWithTemplate?.(template);
      setTitle('');
      onClose();
    } catch {
      toast.error('Failed to create conversation from template');
    }
  };

  const handleSelectPrompt = async (prompt: { name: string; content: string }) => {
    try {
      await onCreateWithPrompt?.(prompt);
      setTitle('');
      onClose();
    } catch {
      toast.error('Failed to create conversation with prompt');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            New Conversation
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 px-6">
          <button
            onClick={() => setTab('blank')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'blank'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Blank
          </button>
          <button
            onClick={() => setTab('template')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'template'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Zap className="w-4 h-4" />
            From Template
          </button>
          <button
            onClick={() => setTab('prompt')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'prompt'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            From Prompt
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {tab === 'blank' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                  Conversation Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Project brainstorm, Code review..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateBasic();
                    }
                  }}
                  disabled={isLoading}
                />
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Start a new conversation with a custom title
              </p>
            </div>
          )}

          {tab === 'template' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Select a template to get started with a pre-configured conversation
              </p>
              <PromptSelector
                workspaceId={workspaceId}
                onSelectPrompt={handleSelectPrompt}
                onSelectTemplate={handleSelectTemplate}
              />
            </div>
          )}

          {tab === 'prompt' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Choose a prompt to use as your conversation's system instructions
              </p>
              <PromptSelector
                workspaceId={workspaceId}
                onSelectPrompt={handleSelectPrompt}
                onSelectTemplate={handleSelectTemplate}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        {tab === 'blank' && (
          <div className="flex gap-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 rounded-b-lg">
            <Button variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button onClick={handleCreateBasic} disabled={isLoading || !title.trim()}>
              {isLoading ? 'Creating...' : 'Create Conversation'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
