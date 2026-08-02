'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Plus, Search, Zap, Trash2 } from 'lucide-react';
import { useWorkspaceTemplates, useCreateTemplate, useDeleteTemplate, TEMPLATE_CATEGORIES } from '@/lib/api/templates';
import { Button } from '@synora/design-system';
import { toast } from 'sonner';

export default function TemplatesPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const { data: templates = [], isLoading, error } = useWorkspaceTemplates(workspaceId);
  const createMutation = useCreateTemplate(workspaceId);
  const deleteMutation = useDeleteTemplate(workspaceId);

  const filteredTemplates = templates.filter((template) => {
    const matchesSearch = template.title.toLowerCase().includes(search.toLowerCase()) ||
      template.description?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !category || template.category === category;
    return matchesSearch && matchesCategory;
  });

  const handleDelete = async (templateId: string) => {
    if (!window.confirm('Delete this template? This cannot be undone.')) return;
    try {
      await deleteMutation.mutateAsync(templateId);
      toast.success('Template deleted');
    } catch {
      toast.error('Failed to delete template');
    }
  };

  const handleCreateTemplate = async () => {
    const title = prompt('Template name:');
    if (!title) return;
    const systemPrompt = prompt('System prompt:');
    if (!systemPrompt) return;
    const categoryValue = prompt('Category (creative, analysis, coding, marketing, education, brainstorm, other):');
    if (!categoryValue) return;

    try {
      await createMutation.mutateAsync({
        title,
        systemPrompt,
        category: categoryValue,
        isPublic: false,
      });
      toast.success('Template created');
    } catch {
      toast.error('Failed to create template');
    }
  };

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">Failed to load templates</p>
          <p className="text-sm text-gray-500 mt-2">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Conversation Templates</h1>
            <Button
              onClick={handleCreateTemplate}
              disabled={createMutation.isPending}
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Template
            </Button>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Start conversations faster with pre-configured templates and system prompts.
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Categories</option>
            {TEMPLATE_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-6 py-6">
          {isLoading ? (
            <div className="flex justify-center items-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400 mb-4">No templates found</p>
              <Button onClick={handleCreateTemplate}>Create your first template</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTemplates.map((template) => (
                <div
                  key={template.id}
                  className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 hover:shadow-lg transition-all flex flex-col"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                        {template.title}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded">
                          {TEMPLATE_CATEGORIES.find(c => c.value === template.category)?.label || template.category}
                        </span>
                        {template.isPublic && (
                          <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded">
                            Public
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {template.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                      {template.description}
                    </p>
                  )}

                  <div className="flex-1">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-semibold">System Prompt</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mb-3 line-clamp-3 bg-gray-50 dark:bg-gray-700 p-3 rounded font-mono text-xs">
                      {template.systemPrompt}
                    </p>
                  </div>

                  {template.suggestedFollowUps && template.suggestedFollowUps.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-semibold">Suggested Follow-ups</p>
                      <div className="space-y-1">
                        {template.suggestedFollowUps.slice(0, 2).map((followUp, idx) => (
                          <p key={idx} className="text-xs text-gray-600 dark:text-gray-400">
                            • {followUp}
                          </p>
                        ))}
                        {template.suggestedFollowUps.length > 2 && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            +{template.suggestedFollowUps.length - 2} more
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <button
                      className="flex-1 px-3 py-2 bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-400 rounded hover:bg-blue-100 dark:hover:bg-blue-800 transition-colors text-sm flex items-center justify-center gap-2"
                    >
                      <Zap className="w-4 h-4" />
                      Use Template
                    </button>
                    <button
                      onClick={() => handleDelete(template.id)}
                      disabled={deleteMutation.isPending}
                      className="px-3 py-2 bg-red-50 dark:bg-red-900 text-red-600 dark:text-red-400 rounded hover:bg-red-100 dark:hover:bg-red-800 transition-colors text-sm"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
