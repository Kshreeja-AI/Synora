/**
 * Hooks system — extensible integration points for custom logic.
 * Enables modular features (search, RAG, moderation, etc.) without core coupling.
 */

import { AIRequest, AIResponse, AIError, HookContext, Hook, AIMessage } from './types';

export interface Logger {
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

export class HookEngine {
  private hooks: Map<string, Hook[]> = new Map();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
    this.initializeDefaultHooks();
  }

  private initializeDefaultHooks(): void {
    const hookTypes = [
      'beforeRequest',
      'afterRequest',
      'onError',
      'streamStart',
      'streamEnd',
      'beforeRender',
      'onToolCall',
      'onSearch',
      'onRAG',
      'onModeration',
      'onAudit',
    ];

    for (const hookType of hookTypes) {
      this.hooks.set(hookType, []);
    }
  }

  register(hookType: string, hook: Hook): void {
    if (!this.hooks.has(hookType)) {
      this.hooks.set(hookType, []);
    }
    this.hooks.get(hookType)!.push(hook);
  }

  unregister(hookType: string, hook: Hook): void {
    const hookList = this.hooks.get(hookType);
    if (hookList) {
      const index = hookList.indexOf(hook);
      if (index > -1) {
        hookList.splice(index, 1);
      }
    }
  }

  async executeHooks(hookType: string, context: HookContext): Promise<void> {
    const hookList = this.hooks.get(hookType);
    if (!hookList) return;

    for (const hook of hookList) {
      try {
        await hook(context);
      } catch (error) {
        this.logger.warn(`Hook ${hookType} failed`, { error });
      }
    }
  }

  async beforeRequest(request: AIRequest): Promise<void> {
    await this.executeHooks('beforeRequest', { request });
  }

  async afterRequest(request: AIRequest, response: AIResponse): Promise<void> {
    await this.executeHooks('afterRequest', { request, response });
  }

  async onError(request: AIRequest, error: AIError): Promise<void> {
    await this.executeHooks('onError', { request, error });
  }

  async onStreamStart(request: AIRequest): Promise<void> {
    await this.executeHooks('streamStart', { request });
  }

  async onStreamEnd(request: AIRequest, eventCount: number): Promise<void> {
    await this.executeHooks('streamEnd', { request, metadata: { eventCount } });
  }

  async onToolCall(request: AIRequest, toolName: string, toolInput: Record<string, unknown>): Promise<void> {
    await this.executeHooks('onToolCall', {
      request,
      metadata: { toolName, toolInput },
    });
  }

  async onSearch(workspaceId: string, query: string, results: number): Promise<void> {
    await this.executeHooks('onSearch', {
      request: {} as AIRequest,
      metadata: { workspaceId, query, results },
    });
  }

  async onRAG(workspaceId: string, query: string, documents: number): Promise<void> {
    await this.executeHooks('onRAG', {
      request: {} as AIRequest,
      metadata: { workspaceId, query, documents },
    });
  }

  async onModeration(content: string, flags: string[]): Promise<void> {
    await this.executeHooks('onModeration', {
      request: {} as AIRequest,
      metadata: { content, flags },
    });
  }

  async onAudit(workspaceId: string, action: string, details: Record<string, unknown>): Promise<void> {
    await this.executeHooks('onAudit', {
      request: {} as AIRequest,
      metadata: { workspaceId, action, ...details },
    });
  }
}

export class ContextBuilder {
  private memoryProvider?: MemoryProvider;
  private searchProvider?: SearchProvider;
  private ragProvider?: RAGProvider;

  constructor(
    private logger: Logger
  ) {}

  setMemoryProvider(provider: MemoryProvider): void {
    this.memoryProvider = provider;
  }

  setSearchProvider(provider: SearchProvider): void {
    this.searchProvider = provider;
  }

  setRAGProvider(provider: RAGProvider): void {
    this.ragProvider = provider;
  }

  async buildContext(
    conversationId: string,
    workspaceId: string,
    userQuery: string
  ): Promise<AIMessage[]> {
    const messages: AIMessage[] = [];

    // 1. Fetch conversation memory
    if (this.memoryProvider) {
      const memoryMessages = await this.memoryProvider.fetchMemory(conversationId);
      messages.push(...memoryMessages);
    }

    // 2. Perform semantic search
    if (this.searchProvider) {
      const searchResults = await this.searchProvider.search(workspaceId, userQuery);
      if (searchResults.length > 0) {
        messages.push({
          role: 'system',
          content: `Search results:\n${searchResults.map(r => r.snippet).join('\n')}`,
        });
      }
    }

    // 3. Fetch RAG documents
    if (this.ragProvider) {
      const documents = await this.ragProvider.retrieve(workspaceId, userQuery);
      if (documents.length > 0) {
        messages.push({
          role: 'system',
          content: `Retrieved documents:\n${documents.map(d => d.content).join('\n')}`,
        });
      }
    }

    return messages;
  }
}

export interface MemoryProvider {
  fetchMemory(conversationId: string): Promise<AIMessage[]>;
  storeMemory(conversationId: string, message: AIMessage): Promise<void>;
  clearMemory(conversationId: string): Promise<void>;
}

export interface SearchProvider {
  search(workspaceId: string, query: string): Promise<SearchResult[]>;
}

export interface SearchResult {
  id: string;
  snippet: string;
  score: number;
}

export interface RAGProvider {
  retrieve(workspaceId: string, query: string): Promise<Document[]>;
}

export interface Document {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}
