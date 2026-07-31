import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import { db } from '../db';
import { logger } from '../utils/logger';
import { NotFoundException, BadRequestException } from '@synora/shared';

interface SearchOptions {
  workspaceId: string;
  query: string;
  skip?: number;
  take?: number;
  type?: 'full-text' | 'semantic';
}

interface SearchResult {
  conversationId: string;
  messageId?: string;
  title: string;
  preview: string;
  score: number;
  createdAt: Date;
  messageCount?: number;
}

export class SearchService {
  private esClient: ElasticsearchClient | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const elasticsearchUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
      this.esClient = new ElasticsearchClient({
        node: elasticsearchUrl,
      });

      // Test connection
      await this.esClient.info();
      logger.info('Elasticsearch connected');

      // Ensure indexes exist
      await this.ensureIndexes();
      this.initialized = true;
    } catch (error) {
      logger.warn('Elasticsearch not available, search will be disabled', { error });
      this.initialized = false;
    }
  }

  private async ensureIndexes(): Promise<void> {
    if (!this.esClient) return;

    const conversationIndex = 'synora-conversations';
    const messageIndex = 'synora-messages';

    // Check if conversation index exists
    try {
      const convExists = await this.esClient.indices.exists({ index: conversationIndex });
      if (!convExists) {
        await this.esClient.indices.create({
          index: conversationIndex,
          body: {
            settings: {
              number_of_shards: 1,
              number_of_replicas: 0,
              analysis: {
                analyzer: {
                  default: {
                    type: 'standard',
                    stopwords: '_english_',
                  },
                },
              },
            },
            mappings: {
              properties: {
                conversationId: { type: 'keyword' },
                workspaceId: { type: 'keyword' },
                title: { type: 'text', analyzer: 'standard' },
                description: { type: 'text', analyzer: 'standard' },
                createdAt: { type: 'date' },
                updatedAt: { type: 'date' },
              },
            },
          },
        });
        logger.info(`Created Elasticsearch index: ${conversationIndex}`);
      }
    } catch (error) {
      logger.warn(`Failed to create conversation index: ${error}`);
    }

    // Check if message index exists
    try {
      const msgExists = await this.esClient.indices.exists({ index: messageIndex });
      if (!msgExists) {
        await this.esClient.indices.create({
          index: messageIndex,
          body: {
            settings: {
              number_of_shards: 1,
              number_of_replicas: 0,
            },
            mappings: {
              properties: {
                messageId: { type: 'keyword' },
                conversationId: { type: 'keyword' },
                workspaceId: { type: 'keyword' },
                content: { type: 'text', analyzer: 'standard' },
                role: { type: 'keyword' },
                createdAt: { type: 'date' },
              },
            },
          },
        });
        logger.info(`Created Elasticsearch index: ${messageIndex}`);
      }
    } catch (error) {
      logger.warn(`Failed to create message index: ${error}`);
    }
  }

  async indexConversation(conversationId: string): Promise<void> {
    if (!this.esClient) return;

    try {
      const conversation = await db.conversation.findUnique({
        where: { id: conversationId },
        select: {
          id: true,
          workspaceId: true,
          title: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      await this.esClient.index({
        index: 'synora-conversations',
        id: conversation.id,
        body: {
          conversationId: conversation.id,
          workspaceId: conversation.workspaceId,
          title: conversation.title,
          description: conversation.description,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        },
      });
    } catch (error) {
      logger.warn('Failed to index conversation', { conversationId, error });
    }
  }

  async indexMessage(messageId: string): Promise<void> {
    if (!this.esClient) return;

    try {
      const message = await db.message.findUnique({
        where: { id: messageId },
        select: {
          id: true,
          conversationId: true,
          content: true,
          role: true,
          createdAt: true,
        },
        include: {
          conversation: {
            select: { workspaceId: true },
          },
        },
      });

      if (!message) {
        throw new NotFoundException('Message not found');
      }

      await this.esClient.index({
        index: 'synora-messages',
        id: message.id,
        body: {
          messageId: message.id,
          conversationId: message.conversationId,
          workspaceId: message.conversation.workspaceId,
          content: message.content,
          role: message.role,
          createdAt: message.createdAt,
        },
      });
    } catch (error) {
      logger.warn('Failed to index message', { messageId, error });
    }
  }

  async searchConversations(options: SearchOptions): Promise<{ items: SearchResult[]; total: number }> {
    if (!this.esClient) {
      return this.fallbackSearchConversations(options);
    }

    try {
      const { workspaceId, query, skip = 0, take = 20 } = options;

      const result = await this.esClient.search({
        index: 'synora-conversations',
        body: {
          query: {
            bool: {
              must: [
                {
                  multi_match: {
                    query,
                    fields: ['title^2', 'description'],
                  },
                },
                {
                  term: { workspaceId },
                },
              ],
            },
          },
          from: skip,
          size: take,
          sort: [{ updatedAt: { order: 'desc' } }],
        },
      });

      const items: SearchResult[] = (result.hits.hits as any[]).map((hit) => ({
        conversationId: hit._source.conversationId,
        title: hit._source.title,
        preview: hit._source.description || '',
        score: hit._score || 0,
        createdAt: new Date(hit._source.createdAt),
      }));

      return {
        items,
        total: (result.hits.total as any).value || 0,
      };
    } catch (error) {
      logger.warn('Search error, falling back to database', { error });
      return this.fallbackSearchConversations(options);
    }
  }

  async searchMessages(options: SearchOptions): Promise<{ items: SearchResult[]; total: number }> {
    if (!this.esClient) {
      return this.fallbackSearchMessages(options);
    }

    try {
      const { workspaceId, query, skip = 0, take = 20 } = options;

      const result = await this.esClient.search({
        index: 'synora-messages',
        body: {
          query: {
            bool: {
              must: [
                {
                  match: { content: query },
                },
                {
                  term: { workspaceId },
                },
              ],
            },
          },
          from: skip,
          size: take,
          sort: [{ createdAt: { order: 'desc' } }],
        },
      });

      const items: SearchResult[] = (result.hits.hits as any[]).map((hit) => ({
        conversationId: hit._source.conversationId,
        messageId: hit._source.messageId,
        title: `Message in conversation`,
        preview: hit._source.content.substring(0, 150),
        score: hit._score || 0,
        createdAt: new Date(hit._source.createdAt),
      }));

      return {
        items,
        total: (result.hits.total as any).value || 0,
      };
    } catch (error) {
      logger.warn('Search error, falling back to database', { error });
      return this.fallbackSearchMessages(options);
    }
  }

  private async fallbackSearchConversations(options: SearchOptions): Promise<{ items: SearchResult[]; total: number }> {
    const { workspaceId, query, skip = 0, take = 20 } = options;

    const conversations = await db.conversation.findMany({
      where: {
        workspaceId,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      skip,
      take,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
    });

    const total = await db.conversation.count({
      where: {
        workspaceId,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
    });

    return {
      items: conversations.map((conv) => ({
        conversationId: conv.id,
        title: conv.title,
        preview: conv.description || '',
        score: 1,
        createdAt: conv.createdAt,
        messageCount: conv._count.messages,
      })),
      total,
    };
  }

  private async fallbackSearchMessages(options: SearchOptions): Promise<{ items: SearchResult[]; total: number }> {
    const { workspaceId, query, skip = 0, take = 20 } = options;

    const messages = await db.message.findMany({
      where: {
        conversation: { workspaceId },
        content: { contains: query, mode: 'insensitive' },
      },
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        conversationId: true,
        content: true,
        createdAt: true,
      },
    });

    const total = await db.message.count({
      where: {
        conversation: { workspaceId },
        content: { contains: query, mode: 'insensitive' },
      },
    });

    return {
      items: messages.map((msg) => ({
        conversationId: msg.conversationId,
        messageId: msg.id,
        title: 'Message in conversation',
        preview: msg.content.substring(0, 150),
        score: 1,
        createdAt: msg.createdAt,
      })),
      total,
    };
  }

  async deleteConversationIndex(conversationId: string): Promise<void> {
    if (!this.esClient) return;

    try {
      await this.esClient.deleteByQuery({
        index: 'synora-conversations',
        body: {
          query: { term: { conversationId } },
        },
      });

      await this.esClient.deleteByQuery({
        index: 'synora-messages',
        body: {
          query: { term: { conversationId } },
        },
      });
    } catch (error) {
      logger.warn('Failed to delete search indexes', { conversationId, error });
    }
  }
}

export const searchService = new SearchService();
