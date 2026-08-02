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
import { useCreatePrompt } from '@/lib/api/prompts';
import { PROMPT_CATEGORIES } from './categories';

interface CreatePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

export function CreatePromptDialog({
  open,
  onOpenChange,
  workspaceId,
}: CreatePromptDialogProps): React.JSX.Element {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { mutate: createPrompt, isPending, error } = useCreatePrompt(workspaceId);

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    setFormError(null);

    if (!name.trim() || !content.trim()) {
      setFormError('Name and content are required');
      return;
    }

    createPrompt(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        content: content.trim(),
        category: category || undefined,
        isPublic,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setName('');
          setDescription('');
          setContent('');
          setCategory('');
          setIsPublic(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Prompt</DialogTitle>
          <DialogDescription>
            Save a reusable prompt for this workspace.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="prompt-name" className="text-xs font-medium">
              Name
            </label>
            <Input
              id="prompt-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Code review checklist"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="prompt-description" className="text-xs font-medium">
              Description (optional)
            </label>
            <Input
              id="prompt-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="When and why to use this prompt"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="prompt-content" className="text-xs font-medium">
              Content
            </label>
            <Textarea
              id="prompt-content"
              rows={6}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="The prompt text…"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="prompt-category" className="text-xs font-medium">
              Category (optional)
            </label>
            <select
              id="prompt-category"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">No category</option>
              {PROMPT_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="prompt-public"
              checked={isPublic}
              onCheckedChange={(checked) => setIsPublic(checked === true)}
            />
            <label htmlFor="prompt-public" className="text-xs">
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
              {error instanceof Error ? error.message : 'Failed to create prompt'}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="gap-2">
              {isPending && <Spinner size="sm" />}
              Create Prompt
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
