import { prisma } from '@synora/database';
import { type Message } from '@synora/database';
import { logger } from '../utils/logger';
import { ValidationException } from '@synora/shared';

export interface ImportData {
  version: string;
  conversation: {
    title: string;
    description?: string;
  };
  messages: Array<{
    content: string;
    role: 'USER' | 'ASSISTANT' | 'SYSTEM';
    model?: string;
  }>;
}

export class ImportService {
  parseJSON(content: string): ImportData {
    try {
      const data = JSON.parse(content);

      if (!data.version || !data.conversation || !data.messages) {
        throw new Error('Invalid export format');
      }

      return data;
    } catch {
      throw new ValidationException('Invalid JSON format');
    }
  }

  parseMarkdown(content: string): ImportData {
    // Simple markdown parser - converts markdown conversation back to structured format
    const lines = content.split('\n');
    let title = '';
    let description = '';
    const messages: Array<{ content: string; role: 'USER' | 'ASSISTANT' | 'SYSTEM' }> = [];
    let currentMessage = '';
    let currentRole: 'USER' | 'ASSISTANT' | 'SYSTEM' = 'USER';

    for (const line of lines) {
      if (line.startsWith('# ')) {
        title = line.substring(2).trim();
      } else if (line.startsWith('> ')) {
        description = line.substring(2).trim();
      } else if (line.startsWith('## ')) {
        // Save previous message if exists
        if (currentMessage.trim()) {
          messages.push({
            content: currentMessage.trim(),
            role: currentRole,
          });
        }

        // Parse role from header
        const header = line.substring(3).trim();
        if (header.toLowerCase().includes('user')) {
          currentRole = 'USER';
        } else if (header.toLowerCase().includes('assistant')) {
          currentRole = 'ASSISTANT';
        } else {
          currentRole = 'SYSTEM';
        }
        currentMessage = '';
      } else if (line.startsWith('---')) {
        // Message separator
        continue;
      } else if (!line.startsWith('_') && !line.startsWith('**') && line.trim()) {
        currentMessage += line + '\n';
      }
    }

    // Save last message
    if (currentMessage.trim()) {
      messages.push({
        content: currentMessage.trim(),
        role: currentRole,
      });
    }

    return {
      version: '1.0',
      conversation: { title: title || 'Imported Conversation', description },
      messages,
    };
  }

  async detectDuplicates(workspaceId: string, importData: ImportData): Promise<string[]> {
    // Check if conversation with same title already exists
    const existing = await prisma.conversation.findFirst({
      where: {
        workspaceId,
        title: importData.conversation.title,
      },
    });

    return existing ? [existing.id] : [];
  }

  async importConversation(
    userId: string,
    workspaceId: string,
    importData: ImportData,
    _options: { overwrite?: boolean } = {}
  ): Promise<string> {
    try {
      // Create conversation with required fields
      const conversation = await prisma.conversation.create({
        data: {
          workspaceId,
          title: importData.conversation.title,
          description: importData.conversation.description || null,
          provider: 'imported',
          model: 'imported',
        },
      });

      // Import messages
      let parentId: string | null = null;
      for (const msgData of importData.messages) {
        const message: Message = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            content: msgData.content,
            role: msgData.role,
            parentId,
          },
        });

        // Build message tree
        if (msgData.role === 'USER') {
          parentId = message.id;
        }
      }

      logger.info('Conversation imported', { conversationId: conversation.id, messageCount: importData.messages.length });

      return conversation.id;
    } catch (error) {
      logger.error('Import failed', { error });
      throw new ValidationException('Import failed');
    }
  }
}

export const importService = new ImportService();
