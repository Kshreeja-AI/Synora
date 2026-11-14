'use client';

import { useState } from 'react';
import { ChevronDown, Search, BookOpen, Sparkles } from 'lucide-react';
import { usePrompts, type Prompt } from '@/lib/api/prompts';
import { useWorkspaceTemplates, type Template } from '@/lib/api/templates';

interface PromptSelectorProps {
  workspaceId: string;
  onSelectPrompt: (prompt: { name: string; content: string }) => void;
  onSelectTemplate?: (template: { title: string; systemPrompt: string }) => void;
}

export function PromptSelector({ workspaceId, onSelectPrompt, onSelectTemplate }: PromptSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<'prompts' | 'templates'>('prompts');
  const [search, setSearch] = useState('');

  const { data: prompts = [] } = usePrompts(workspaceId);
  const { data: templates = [] } = useWorkspaceTemplates(workspaceId, { enabled: tab === 'templates' });

  const filteredPrompts = prompts.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredTemplates = templates.filter(
    (t: Template) =>
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.description?.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelectPrompt = (prompt: Prompt) => {
    onSelectPrompt({ name: prompt.name, content: prompt.content });
    setIsOpen(false);
    setSearch('');
  };

  const handleSelectTemplate = (template: Template) => {
    onSelectTemplate?.({ title: template.title, systemPrompt: template.systemPrompt });
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        type="button" aria-expanded={isOpen} className="inline-flex items-center gap-2 px-3 py-2 border border-border rounded-lg hover:bg-accent transition-colors text-sm"
      >
        <Sparkles className="w-4 h-4" />
        Quick Start
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 w-96 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg z-50">
          {/* Tabs */}
          <div className="flex border-b border-border ">
            <button
              onClick={() => {
                setTab('prompts');
                setSearch('');
              }}
              className={`flex-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'prompts'
                  ? 'border-primary text-primary '
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Sparkles className="w-4 h-4 inline mr-2" />
              Prompts
            </button>
            <button
              onClick={() => {
                setTab('templates');
                setSearch('');
              }}
              className={`flex-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'templates'
                  ? 'border-primary text-primary '
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <BookOpen className="w-4 h-4 inline mr-2" />
              Templates
            </button>
          </div>

          {/* Search */}
          <div className="p-3 border-b border-border ">
            <div className="relative">
              <Search aria-hidden className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search..." aria-label="Search prompts and templates"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-input bg-background text-foreground rounded text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                autoFocus
              />
            </div>
          </div>

          {/* Content */}
          <div className="max-h-80 overflow-y-auto">
            {tab === 'prompts' ? (
              filteredPrompts.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground ">
                  {prompts.length === 0 ? 'No prompts yet' : 'No matching prompts'}
                </div>
              ) : (
                <div className="divide-y divide-border ">
                  {filteredPrompts.map((prompt) => (
                    <button
                      key={prompt.id}
                      onClick={() => handleSelectPrompt(prompt)}
                      className="w-full text-left px-4 py-3 hover:bg-accent transition-colors"
                    >
                      <div className="font-medium text-sm text-foreground">
                        {prompt.name}
                      </div>
                      {prompt.description && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          {prompt.description}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2 bg-muted p-2 rounded mt-2">
                        {prompt.content}
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : filteredTemplates.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground ">
                {templates.length === 0 ? 'No templates yet' : 'No matching templates'}
              </div>
            ) : (
              <div className="divide-y divide-border ">
                {filteredTemplates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => handleSelectTemplate(template as Template)}
                    className="w-full text-left px-4 py-3 hover:bg-accent transition-colors"
                  >
                    <div className="font-medium text-sm text-foreground">
                      {template.title}
                    </div>
                    {template.description && (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-1">
                        {template.description}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2 bg-muted p-2 rounded mt-2">
                      {template.systemPrompt}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-border bg-muted text-xs text-muted-foreground ">
            Manage your library in Knowledge Center
          </div>
        </div>
      )}
    </div>
  );
}
