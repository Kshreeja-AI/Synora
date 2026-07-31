import { prisma } from '@synora/database';
import { logger } from '../utils/logger';
import { NotFoundException } from '@synora/shared';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

export type ExportFormat = 'json' | 'markdown';

export interface ExportJob {
  id: string;
  conversationId: string;
  format: ExportFormat;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  outputPath?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export class ExportService {
  async createExportJob(conversationId: string, format: ExportFormat): Promise<ExportJob> {
    const job: ExportJob = {
      id: `export-${randomBytes(12).toString('hex')}`,
      conversationId,
      format,
      status: 'pending',
      createdAt: new Date(),
    };
    return job;
  }

  async exportToJSON(conversationId: string): Promise<string> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
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

  async saveExportToFile(jobId: string, content: string, format: ExportFormat): Promise<string> {
    const exportDir = join(process.cwd(), 'exports');
    const filename = `${jobId}.${format === 'markdown' ? 'md' : format}`;
    const filepath = join(exportDir, filename);

    return new Promise((resolve, reject) => {
      const stream = createWriteStream(filepath);
      stream.write(content);
      stream.end(() => {
        resolve(filepath);
      });
      stream.on('error', reject);
    });
  }

  async cleanupOldExports(olderThanDays: number = 30): Promise<number> {
    logger.info(`Cleanup exports older than ${olderThanDays} days scheduled`);
    return 0;
  }
}

export const exportService = new ExportService();
