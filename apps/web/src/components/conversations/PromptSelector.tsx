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
        className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
      >
        <Sparkles className="w-4 h-4" />
        Quick Start
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
          {/* Tabs */}
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => {
                setTab('prompts');
                setSearch('');
              }}
              className={`flex-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'prompts'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
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
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <BookOpen className="w-4 h-4 inline mr-2" />
              Templates
            </button>
          </div>

          {/* Search */}
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>
          </div>

          {/* Content */}
          <div className="max-h-80 overflow-y-auto">
            {tab === 'prompts' ? (
              filteredPrompts.length === 0 ? (
                <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                  {prompts.length === 0 ? 'No prompts yet' : 'No matching prompts'}
                </div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredPrompts.map((prompt) => (
                    <button
                      key={prompt.id}
                      onClick={() => handleSelectPrompt(prompt)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <div className="font-medium text-sm text-gray-900 dark:text-white">
                        {prompt.name}
                      </div>
                      {prompt.description && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-1">
                          {prompt.description}
                        </div>
                      )}
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2 bg-gray-50 dark:bg-gray-600 p-2 rounded mt-2">
                        {prompt.content}
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : filteredTemplates.length === 0 ? (
              <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                {templates.length === 0 ? 'No templates yet' : 'No matching templates'}
              </div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredTemplates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => handleSelectTemplate(template as Template)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="font-medium text-sm text-gray-900 dark:text-white">
                      {template.title}
                    </div>
                    {template.description && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-1">
                        {template.description}
                      </div>
                    )}
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2 bg-gray-50 dark:bg-gray-600 p-2 rounded mt-2">
                      {template.systemPrompt}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 text-xs text-gray-600 dark:text-gray-400">
            Manage your library in Knowledge Center
          </div>
        </div>
      )}
    </div>
  );
}
