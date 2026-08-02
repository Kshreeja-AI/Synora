'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Plus, Search, Star, Trash2, Copy } from 'lucide-react';
import { usePrompts, useCreatePrompt, useDeletePrompt, useTogglePromptFavorite } from '@/lib/api/prompts';
import { Button } from '@synora/design-system';
import { toast } from 'sonner';

export default function PromptsPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const { data: prompts = [], isLoading, error } = usePrompts(workspaceId, { category: category || undefined });
  const createMutation = useCreatePrompt(workspaceId);
  const deleteMutation = useDeletePrompt(workspaceId);
  const favoriteMutation = useTogglePromptFavorite(workspaceId);

  const filteredPrompts = prompts.filter((prompt) => {
    const matchesSearch = prompt.name.toLowerCase().includes(search.toLowerCase()) ||
      prompt.description?.toLowerCase().includes(search.toLowerCase()) ||
      prompt.content.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  const handleDelete = async (promptId: string) => {
    if (!window.confirm('Delete this prompt? This cannot be undone.')) return;
    try {
      await deleteMutation.mutateAsync(promptId);
      toast.success('Prompt deleted');
    } catch {
      toast.error('Failed to delete prompt');
    }
  };

  const handleToggleFavorite = async (promptId: string) => {
    try {
      await favoriteMutation.mutateAsync(promptId);
      toast.success('Favorite updated');
    } catch {
      toast.error('Failed to update favorite');
    }
  };

  const handleCopy = (prompt: any) => {
    navigator.clipboard.writeText(prompt.content);
    toast.success('Prompt copied to clipboard');
  };

  const handleCreatePrompt = async () => {
    const name = prompt('Prompt name:');
    if (!name) return;
    const content = prompt('Prompt content:');
    if (!content) return;

    try {
      await createMutation.mutateAsync({ name, content, isPublic: false });
      toast.success('Prompt created');
    } catch {
      toast.error('Failed to create prompt');
    }
  };

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">Failed to load prompts</p>
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
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Prompt Library</h1>
            <Button
              onClick={handleCreatePrompt}
              disabled={createMutation.isPending}
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Prompt
            </Button>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Create, organize, and manage reusable prompts for your conversations.
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
              placeholder="Search prompts..."
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
            <option value="creative">Creative</option>
            <option value="analysis">Analysis</option>
            <option value="coding">Coding</option>
            <option value="marketing">Marketing</option>
            <option value="other">Other</option>
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
          ) : filteredPrompts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400 mb-4">No prompts found</p>
              <Button onClick={handleCreatePrompt}>Create your first prompt</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPrompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 hover:shadow-lg transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                        {prompt.name}
                      </h3>
                      {prompt.category && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {prompt.category}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleToggleFavorite(prompt.id)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      <Star
                        className={`w-5 h-5 ${
                          prompt.isFavorite
                            ? 'fill-yellow-400 text-yellow-400'
                            : 'text-gray-400'
                        }`}
                      />
                    </button>
                  </div>

                  {prompt.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                      {prompt.description}
                    </p>
                  )}

                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-4 line-clamp-3 bg-gray-50 dark:bg-gray-700 p-3 rounded">
                    {prompt.content}
                  </p>

                  <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-4">
                    <div className="flex gap-3">
                      <span>Used {prompt.usageCount} times</span>
                      {prompt.rating > 0 && <span>★ {prompt.rating.toFixed(1)}</span>}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCopy(prompt)}
                      className="flex-1 px-3 py-2 bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-400 rounded hover:bg-blue-100 dark:hover:bg-blue-800 transition-colors text-sm flex items-center justify-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      Copy
                    </button>
                    <button
                      onClick={() => handleDelete(prompt.id)}
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
