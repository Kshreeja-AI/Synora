import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGetText = vi.fn();
const mockDestroy = vi.fn();

vi.mock('pdf-parse', () => ({
  PDFParse: vi.fn().mockImplementation(() => ({
    getText: mockGetText,
    destroy: mockDestroy,
  })),
}));

import {
  TextFileProcessor,
  PDFFileProcessor,
  ImageFileProcessor,
  FallbackFileProcessor,
  FileProcessorRegistry,
} from '../processors';
import { PDFParse } from 'pdf-parse';

describe('TextFileProcessor', () => {
  const processor = new TextFileProcessor();

  it('supports text and JSON mime types', () => {
    expect(processor.supports('text/plain')).toBe(true);
    expect(processor.supports('application/json')).toBe(true);
    expect(processor.supports('image/png')).toBe(false);
  });

  it('extracts text from buffer', async () => {
    const buffer = Buffer.from('Hello, world!');
    const result = await processor.process(buffer, 'text/plain');
    expect(result.success).toBe(true);
    expect(result.extractedText).toBe('Hello, world!');
  });

  it('caps text at 1MB', async () => {
    const longText = 'x'.repeat(1_100_000);
    const buffer = Buffer.from(longText);
    const result = await processor.process(buffer, 'text/plain');
    expect(result.success).toBe(true);
    expect(result.extractedText!.length).toBeLessThanOrEqual(1_000_000);
  });
});

describe('PDFFileProcessor', () => {
  let processor: PDFFileProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDestroy.mockResolvedValue(undefined);
    processor = new PDFFileProcessor();
  });

  it('supports application/pdf only', () => {
    expect(processor.supports('application/pdf')).toBe(true);
    expect(processor.supports('text/plain')).toBe(false);
  });

  it('extracts text from a real PDF buffer via pdf-parse', async () => {
    mockGetText.mockResolvedValue({ text: 'Extracted PDF content here', pages: [], total: 1 });

    const buffer = Buffer.from('%PDF-1.4 fake pdf content');
    const result = await processor.process(buffer, 'application/pdf');

    expect(result.success).toBe(true);
    expect(result.extractedText).toBe('Extracted PDF content here');
    expect(PDFParse).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.any(Uint8Array) }),
    );
  });

  it('returns empty string for PDFs with no extractable text', async () => {
    mockGetText.mockResolvedValue({ text: '   ', pages: [], total: 1 });

    const buffer = Buffer.from('%PDF-1.4 image-only pdf');
    const result = await processor.process(buffer, 'application/pdf');

    expect(result.success).toBe(true);
    expect(result.extractedText).toBe('');
  });

  it('rejects empty buffer', async () => {
    const result = await processor.process(Buffer.alloc(0), 'application/pdf');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Empty');
  });

  it('rejects oversized PDFs', async () => {
    const huge = Buffer.alloc(51 * 1024 * 1024);
    const result = await processor.process(huge, 'application/pdf');
    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds maximum');
  });

  it('returns error when pdf-parse throws', async () => {
    mockGetText.mockRejectedValue(new Error('Corrupt PDF data'));

    const buffer = Buffer.from('not actually a pdf');
    const result = await processor.process(buffer, 'application/pdf');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Corrupt PDF data');
  });

  it('calls destroy() for cleanup', async () => {
    mockGetText.mockResolvedValue({ text: 'content', pages: [], total: 1 });

    const buffer = Buffer.from('%PDF-1.4');
    await processor.process(buffer, 'application/pdf');

    expect(mockDestroy).toHaveBeenCalled();
  });

  it('never returns placeholder text like "[PDF file received"', async () => {
    mockGetText.mockResolvedValue({ text: 'Real content', pages: [], total: 1 });

    const buffer = Buffer.from('%PDF-1.4');
    const result = await processor.process(buffer, 'application/pdf');

    expect(result.extractedText).not.toContain('[PDF file received');
    expect(result.extractedText).not.toContain('placeholder');
    expect(result.extractedText).not.toContain('not yet implemented');
  });
});

describe('ImageFileProcessor', () => {
  const processor = new ImageFileProcessor();

  it('supports image mime types', () => {
    expect(processor.supports('image/jpeg')).toBe(true);
    expect(processor.supports('image/png')).toBe(true);
    expect(processor.supports('text/plain')).toBe(false);
  });

  it('returns metadata about the image', async () => {
    const buffer = Buffer.alloc(1024);
    const result = await processor.process(buffer, 'image/png');
    expect(result.success).toBe(true);
    expect(result.extractedText).toContain('image/png');
    expect(result.extractedText).toContain('1.00KB');
  });
});

describe('FallbackFileProcessor', () => {
  const processor = new FallbackFileProcessor();

  it('supports any mime type', () => {
    expect(processor.supports('application/octet-stream')).toBe(true);
    expect(processor.supports('video/mp4')).toBe(true);
  });
});

describe('FileProcessorRegistry', () => {
  it('routes PDF to PDFFileProcessor', () => {
    const registry = new FileProcessorRegistry();
    const processor = registry.find('application/pdf');
    expect(processor).toBeInstanceOf(PDFFileProcessor);
  });

  it('routes text to TextFileProcessor', () => {
    const registry = new FileProcessorRegistry();
    const processor = registry.find('text/plain');
    expect(processor).toBeInstanceOf(TextFileProcessor);
  });

  it('routes images to ImageFileProcessor', () => {
    const registry = new FileProcessorRegistry();
    const processor = registry.find('image/jpeg');
    expect(processor).toBeInstanceOf(ImageFileProcessor);
  });

  it('routes unknown types to FallbackFileProcessor', () => {
    const registry = new FileProcessorRegistry();
    const processor = registry.find('application/octet-stream');
    expect(processor).toBeInstanceOf(FallbackFileProcessor);
  });
});
