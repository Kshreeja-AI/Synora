import { PDFParse } from 'pdf-parse';
import { FileProcessor, FileProcessorResult } from './types';
import { logger } from '../utils/logger';

// Text file processor (plaintext, markdown, code)
export class TextFileProcessor implements FileProcessor {
  private supportedTypes = [
    'text/plain',
    'text/markdown',
    'text/x-markdown',
    'application/json',
    'application/xml',
    'text/xml',
    'text/csv',
  ];

  // Also support code files by extension
  private codeExtensions = [
    '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.h',
    '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.r',
  ];

  supports(mimeType: string): boolean {
    return this.supportedTypes.includes(mimeType);
  }

  async process(buffer: Buffer, _mimeType: string): Promise<FileProcessorResult> {
    try {
      const text = buffer.toString('utf-8', 0, Math.min(buffer.length, 1000000)); // Limit to 1MB
      return { extractedText: text, success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[TextProcessor] Processing failed', { error: message });
      return { success: false, error: message };
    }
  }
}

export class PDFFileProcessor implements FileProcessor {
  private readonly MAX_PDF_SIZE = 50 * 1024 * 1024; // 50 MB

  supports(mimeType: string): boolean {
    return mimeType === 'application/pdf';
  }

  async process(buffer: Buffer, _mimeType: string): Promise<FileProcessorResult> {
    if (buffer.length === 0) {
      return { success: false, error: 'Empty PDF buffer' };
    }

    if (buffer.length > this.MAX_PDF_SIZE) {
      return { success: false, error: `PDF exceeds maximum size of ${this.MAX_PDF_SIZE / (1024 * 1024)}MB` };
    }

    let parser: PDFParse | undefined;
    try {
      parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();

      const text = result.text?.trim();
      if (!text) {
        return { extractedText: '', success: true };
      }

      return {
        extractedText: text.slice(0, 1_000_000),
        success: true,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[PDFProcessor] Extraction failed', { error: message });
      return { success: false, error: `PDF extraction failed: ${message}` };
    } finally {
      await parser?.destroy().catch(() => {});
    }
  }
}

// Image processor (stub - extracts basic metadata)
export class ImageFileProcessor implements FileProcessor {
  private supportedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
  ];

  supports(mimeType: string): boolean {
    return this.supportedTypes.includes(mimeType);
  }

  async process(buffer: Buffer, mimeType: string): Promise<FileProcessorResult> {
    try {
      // Stub: Image processing requires vision API or image processing library
      // For now, extract basic metadata
      const sizeKB = (buffer.length / 1024).toFixed(2);
      const extractedText = `[Image file (${mimeType}) - ${sizeKB}KB]\nFor vision analysis, ensure Claude with vision capability is selected.`;
      return { extractedText, success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[ImageProcessor] Processing failed', { error: message });
      return { success: false, error: message };
    }
  }
}

// Fallback processor for unsupported types
export class FallbackFileProcessor implements FileProcessor {
  supports(_mimeType: string): boolean {
    return true; // Supports everything as fallback
  }

  async process(buffer: Buffer, mimeType: string): Promise<FileProcessorResult> {
    try {
      const sizeKB = (buffer.length / 1024).toFixed(2);
      const extractedText = `[File (${mimeType}) - ${sizeKB}KB]\nFile type not natively supported. Upload as context for the model to analyze if you have vision capabilities enabled.`;
      return { extractedText, success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[FallbackProcessor] Processing failed', { error: message });
      return { success: false, error: message };
    }
  }
}

// Processor registry
export class FileProcessorRegistry {
  private processors: FileProcessor[] = [];

  constructor() {
    // Register processors in order of specificity
    this.processors.push(new PDFFileProcessor());
    this.processors.push(new ImageFileProcessor());
    this.processors.push(new TextFileProcessor());
    this.processors.push(new FallbackFileProcessor());
  }

  find(mimeType: string): FileProcessor {
    const processor = this.processors.find((p) => p.supports(mimeType));
    return processor || this.processors[this.processors.length - 1]; // Fallback
  }

  async process(buffer: Buffer, mimeType: string): Promise<FileProcessorResult> {
    const processor = this.find(mimeType);
    return processor.process(buffer, mimeType);
  }
}

export const processorRegistry = new FileProcessorRegistry();
