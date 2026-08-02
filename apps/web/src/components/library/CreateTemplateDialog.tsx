'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@synora/design-system/components/Dialog';
import { Button } from '@synora/design-system/components/Button';
import { Input } from '@synora/design-system/components/Input';
import { Textarea } from '@synora/design-system/components/Textarea';
import { Checkbox } from '@synora/design-system/components/Checkbox';
import { Spinner } from '@synora/design-system/components/Spinner';
import { useCreateTemplate, TEMPLATE_CATEGORIES } from '@/lib/api/templates';

interface CreateTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

export function CreateTemplateDialog({
  open,
  onOpenChange,
  workspaceId,
}: CreateTemplateDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(TEMPLATE_CATEGORIES[0].value);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [initialUserMessage, setInitialUserMessage] = useState('');
  const [followUps, setFollowUps] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { mutate: createTemplate, isPending, error } = useCreateTemplate(workspaceId);

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    setFormError(null);

    if (!title.trim() || !systemPrompt.trim()) {
      setFormError('Title and system prompt are required');
      return;
    }

    createTemplate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        systemPrompt: systemPrompt.trim(),
        initialUserMessage: initialUserMessage.trim() || undefined,
        suggestedFollowUps: followUps
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
        isPublic,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setTitle('');
          setDescription('');
          setSystemPrompt('');
          setInitialUserMessage('');
          setFollowUps('');
          setIsPublic(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Template</DialogTitle>
          <DialogDescription>
            A template starts a conversation with a system prompt already in place.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="template-title" className="text-xs font-medium">
              Title
            </label>
            <Input
              id="template-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Technical design review"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="template-description" className="text-xs font-medium">
              Description (optional)
            </label>
            <Input
              id="template-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this template is for"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="template-category" className="text-xs font-medium">
              Category
            </label>
            <select
              id="template-category"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {TEMPLATE_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="template-system-prompt" className="text-xs font-medium">
              System prompt
            </label>
            <Textarea
              id="template-system-prompt"
              rows={5}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="You are a staff engineer reviewing a design document…"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="template-initial-message" className="text-xs font-medium">
              Suggested opening message (optional)
            </label>
            <Textarea
              id="template-initial-message"
              rows={2}
              value={initialUserMessage}
              onChange={(event) => setInitialUserMessage(event.target.value)}
              placeholder="Here is the design doc I'd like reviewed…"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="template-follow-ups" className="text-xs font-medium">
              Suggested follow-ups (one per line, optional)
            </label>
            <Textarea
              id="template-follow-ups"
              rows={3}
              value={followUps}
              onChange={(event) => setFollowUps(event.target.value)}
              placeholder={'What are the failure modes?\nWhat would you cut?'}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="template-public"
              checked={isPublic}
              onCheckedChange={(checked) => setIsPublic(checked === true)}
            />
            <label htmlFor="template-public" className="text-xs">
              Share with the whole workspace
            </label>
          </div>

          {formError && (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error instanceof Error ? error.message : 'Failed to create template'}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="gap-2">
              {isPending && <Spinner size="sm" />}
              Create Template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
