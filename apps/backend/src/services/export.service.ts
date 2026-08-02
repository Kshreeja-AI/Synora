import { prisma } from '@synora/database';
import { logger } from '../utils/logger';
import { NotFoundException } from '@synora/shared';

export type ExportFormat = 'json' | 'markdown';

/**
 * Conversation export. Both formats deliberately exclude soft-deleted
 * messages — "deleted" must hold in every representation of the
 * conversation that leaves the database, not just the chat view.
 * Sibling branches ARE included (the JSON format carries parentId so
 * the tree can be reconstructed): an export is the user's own full
 * record of the conversation.
 */
export class ExportService {
  async exportToJSON(conversationId: string): Promise<string> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          where: { deletedAt: null },
          include: {
            attachments: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      conversation: {
        id: conversation.id,
        title: conversation.title,
        description: conversation.description,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      messages: conversation.messages.map((msg) => ({
        id: msg.id,
        content: msg.content,
        role: msg.role,
        parentId: msg.parentId,
        createdAt: msg.createdAt,
        attachments: msg.attachments.map((att) => ({
          url: att.url,
          mimeType: att.mimeType,
          name: att.name,
        })),
      })),
      metadata: {
        messageCount: conversation.messages.length,
        wordCount: conversation.messages.reduce((sum: number, msg) => sum + msg.content.split(/\s+/).length, 0),
      },
    };

    return JSON.stringify(exportData, null, 2);
  }

  async exportToMarkdown(conversationId: string): Promise<string> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          where: { deletedAt: null },
          include: { attachments: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    let markdown = `# ${conversation.title}\n\n`;

    if (conversation.description) {
      markdown += `> ${conversation.description}\n\n`;
    }

    markdown += `**Exported:** ${new Date().toLocaleString()}\n`;
    markdown += `**Messages:** ${conversation.messages.length}\n\n`;
    markdown += '---\n\n';

    for (const msg of conversation.messages) {
      const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1).toLowerCase();
      markdown += `## ${role}\n\n`;

      markdown += `${msg.content}\n\n`;

      if (msg.attachments.length > 0) {
        markdown += '**Attachments:**\n';
        for (const att of msg.attachments) {
          markdown += `- [${att.name}](${att.url})\n`;
        }
        markdown += '\n';
      }

      markdown += '---\n\n';
    }

    return markdown;
  }

  async export(userId: string, conversationId: string, options: { format?: string } = {}): Promise<{ content: string; format: ExportFormat }> {
    const format = (options.format?.toLowerCase() || 'markdown') as ExportFormat;

    let content: string;
    if (format === 'json') {
      content = await this.exportToJSON(conversationId);
    } else {
      content = await this.exportToMarkdown(conversationId);
    }

    logger.info('[export] Conversation exported', { conversationId, userId, format });
    return { content, format };
  }
}

export const exportService = new ExportService();
