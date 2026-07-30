'use client';

import { Conversation } from '@/lib/types/conversations';

interface ChatHeaderProps {
  conversation?: Conversation;
  isLoading: boolean;
  selectedModel: string;
  selectedProvider: string;
  temperature: number;
  topP: number;
  contextWindow: number;
  onModelChange: (model: string) => void;
  onProviderChange: (provider: string) => void;
  onTemperatureChange: (temp: number) => void;
  onTopPChange: (topP: number) => void;
  onContextWindowChange: (window: number) => void;
  onToggleSidebar: () => void;
}

export function ChatHeader({
  conversation,
  isLoading,
  selectedModel,
  selectedProvider,
  temperature,
  topP,
  contextWindow,
  onModelChange,
  onProviderChange,
  onTemperatureChange,
  onTopPChange,
  onContextWindowChange,
  onToggleSidebar,
}: ChatHeaderProps) {
  return (
    <div className="border-b border-slate-200 dark:border-slate-800 px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onToggleSidebar}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
            aria-label="Toggle sidebar"
          >
            ☰
          </button>
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
              {isLoading ? 'Loading...' : conversation?.title || 'New Conversation'}
            </h1>
            {conversation?.description && (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {conversation.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Settings row */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Provider */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Provider:
          </label>
          <select
            value={selectedProvider}
            onChange={(e) => onProviderChange(e.target.value)}
            className="px-3 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="google">Google</option>
          </select>
        </div>

        {/* Model */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Model:
          </label>
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            className="px-3 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
          >
            <option value="claude-opus">Claude Opus</option>
            <option value="claude-sonnet">Claude Sonnet</option>
            <option value="gpt-4">GPT-4</option>
            <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
          </select>
        </div>

        {/* Temperature */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Temp:
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={temperature}
            onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
            className="w-24"
          />
          <span className="text-sm text-slate-600 dark:text-slate-400 w-8">
            {temperature.toFixed(1)}
          </span>
        </div>

        {/* Top P */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Top P:
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={topP}
            onChange={(e) => onTopPChange(parseFloat(e.target.value))}
            className="w-24"
          />
          <span className="text-sm text-slate-600 dark:text-slate-400 w-8">
            {topP.toFixed(1)}
          </span>
        </div>

        {/* Context Window */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Context:
          </label>
          <input
            type="number"
            value={contextWindow}
            onChange={(e) => onContextWindowChange(parseInt(e.target.value))}
            className="w-20 px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
          />
        </div>
      </div>
    </div>
  );
}
