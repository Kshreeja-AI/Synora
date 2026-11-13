'use client';

import { useState } from 'react';
import { Zap, Sparkles } from 'lucide-react';
import { PromptSelector } from './PromptSelector';
import { ModelPicker, type ModelPickerValue } from '@/components/chat/ModelPicker';
import {
  Button,
  Input,
  Label,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  cn,
} from '@synora/design-system';
import { toast } from 'sonner';

interface ConversationCreateDialogProps {
  isOpen: boolean;
  workspaceId: string;
  isLoading?: boolean;
  /** Starting provider/model for the picker on the blank tab. The picker
   *  writes back through onCreateBasic so the caller stays authoritative
   *  about what to persist. */
  defaultModel?: ModelPickerValue;
  onClose: () => void;
  onCreateBasic: (title: string, model: ModelPickerValue) => Promise<void>;
  onCreateWithTemplate?: (template: { title: string; systemPrompt: string }) => Promise<void>;
  onCreateWithPrompt?: (prompt: { name: string; content: string }) => Promise<void>;
}

export function ConversationCreateDialog({
  isOpen,
  workspaceId,
  isLoading = false,
  defaultModel = { provider: 'anthropic', model: 'claude-sonnet-5' },
  onClose,
  onCreateBasic,
  onCreateWithTemplate,
  onCreateWithPrompt,
}: ConversationCreateDialogProps) {
  const [tab, setTab] = useState<'blank' | 'template' | 'prompt'>('blank');
  const [title, setTitle] = useState('');
  const [model, setModel] = useState<ModelPickerValue>(defaultModel);

  const handleCreateBasic = async () => {
    if (!title.trim()) {
      toast.error('Please enter a conversation title');
      return;
    }
    try {
      await onCreateBasic(title, model);
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

  const tabClass =
    'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const inactiveTab = 'border-transparent text-muted-foreground hover:text-foreground';

  return (
    <Dialog open={isOpen} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle className="text-xl">New Conversation</DialogTitle>
          <DialogDescription className="sr-only">
            Start blank, or from a template or saved prompt.
          </DialogDescription>
        </DialogHeader>

        <div role="tablist" aria-label="How to start" className="flex overflow-x-auto border-b border-border px-6">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'blank'}
              onClick={() => setTab('blank')}
              className={cn(tabClass, tab === 'blank' ? 'border-primary text-primary' : inactiveTab)}
            >
              Blank
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'template'}
              onClick={() => setTab('template')}
              className={cn(tabClass, tab === 'template' ? 'border-primary text-primary' : inactiveTab)}
            >
              <Zap aria-hidden className="w-4 h-4" />
              From Template
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'prompt'}
              onClick={() => setTab('prompt')}
              className={cn(tabClass, tab === 'prompt' ? 'border-primary text-primary' : inactiveTab)}
            >
              <Sparkles aria-hidden className="w-4 h-4" />
              From Prompt
            </button>
        </div>

        <div className="p-6">
          {tab === 'blank' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="conversation-title">Conversation Title</Label>
                <Input
                  id="conversation-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Project brainstorm, Code review..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateBasic();
                    }
                  }}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label>Model</Label>
                <ModelPicker value={model} onChange={setModel} disabled={isLoading} />
              </div>
              <p className="text-sm text-muted-foreground">
                Start a new conversation. You can change the model any time later.
              </p>
            </div>
          )}

          {tab === 'template' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
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
              <p className="text-sm text-muted-foreground">
                Choose a prompt to use as your conversation&apos;s system instructions
              </p>
              <PromptSelector
                workspaceId={workspaceId}
                onSelectPrompt={handleSelectPrompt}
                onSelectTemplate={handleSelectTemplate}
              />
            </div>
          )}
        </div>

        {tab === 'blank' && (
          <div className="flex flex-col-reverse gap-3 rounded-b-lg border-t border-border bg-muted p-6 sm:flex-row">
            <Button variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button onClick={handleCreateBasic} disabled={isLoading || !title.trim()}>
              {isLoading ? 'Creating...' : 'Create Conversation'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
