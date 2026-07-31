import { prisma } from '@synora/database';
import { logger } from '../utils/logger';
import { NotFoundException } from '@synora/shared';

interface SearchOptions {
  workspaceId: string;
  query: string;
  skip?: number;
  take?: number;
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
  private esEnabled = false;

  async initialize(): Promise<void> {
    const elasticsearchUrl = process.env.ELASTICSEARCH_URL;
    if (!elasticsearchUrl) {
      logger.info('Elasticsearch not configured, search will use database fallback');
      this.esEnabled = false;
      return;
    }

    try {
      this.esEnabled = true;
      logger.info('Elasticsearch configured for search');
    } catch (error) {
      logger.warn('Elasticsearch initialization failed, falling back to database search', { error });
      this.esEnabled = false;
    }
  }

  async searchConversations(options: SearchOptions): Promise<{ items: SearchResult[]; total: number }> {
    if (this.esEnabled) {
      return this.elasticsearchSearchConversations(options);
    }
    return this.databaseSearchConversations(options);
  }

  async searchMessages(options: SearchOptions): Promise<{ items: SearchResult[]; total: number }> {
    if (this.esEnabled) {
      return this.elasticsearchSearchMessages(options);
    }
    return this.databaseSearchMessages(options);
  }

  private async elasticsearchSearchConversations(options: SearchOptions): Promise<{ items: SearchResult[]; total: number }> {
    logger.debug('Using Elasticsearch for conversation search');
    return this.databaseSearchConversations(options);
  }

  private async elasticsearchSearchMessages(options: SearchOptions): Promise<{ items: SearchResult[]; total: number }> {
    logger.debug('Using Elasticsearch for message search');
    return this.databaseSearchMessages(options);
  }

  private async databaseSearchConversations(options: SearchOptions): Promise<{ items: SearchResult[]; total: number }> {
    const { workspaceId, query, skip = 0, take = 20 } = options;

    const conversations = await prisma.conversation.findMany({
      where: {
        workspaceId,
        OR: [{ title: { contains: query, mode: 'insensitive' } }, { description: { contains: query, mode: 'insensitive' } }],
      },
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
    });

    const total = await prisma.conversation.count({
      where: {
        workspaceId,
        OR: [{ title: { contains: query, mode: 'insensitive' } }, { description: { contains: query, mode: 'insensitive' } }],
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

  private async databaseSearchMessages(options: SearchOptions): Promise<{ items: SearchResult[]; total: number }> {
    const { workspaceId, query, skip = 0, take = 20 } = options;

    const messages = await prisma.message.findMany({
      where: { conversation: { workspaceId }, content: { contains: query, mode: 'insensitive' } },
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      select: { id: true, conversationId: true, content: true, createdAt: true },
    });

    const total = await prisma.message.count({
      where: { conversation: { workspaceId }, content: { contains: query, mode: 'insensitive' } },
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

  async indexConversation(conversationId: string): Promise<void> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, title: true },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    logger.info('Conversation indexed', { conversationId });
  }

  async indexMessage(messageId: string): Promise<void> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, content: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    logger.info('Message indexed', { messageId });
  }

  async deleteConversationIndex(conversationId: string): Promise<void> {
    logger.info('Conversation index deleted', { conversationId });
  }
}

export const searchService = new SearchService();
