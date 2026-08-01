export interface FileProcessorResult {
  extractedText?: string;
  success: boolean;
  error?: string;
}

export interface FileStorageProvider {
  upload(
    key: string,
    buffer: Buffer,
    mimeType: string,
    metadata?: Record<string, string>
  ): Promise<{ url: string; key: string }>;

  delete(key: string): Promise<void>;

  download(key: string): Promise<Buffer>;

  getPresignedUrl(key: string, expirationSeconds?: number): Promise<string>;
}

export interface FileProcessor {
  supports(mimeType: string): boolean;

  process(buffer: Buffer, mimeType: string): Promise<FileProcessorResult>;
}

export interface VirusScanProvider {
  scan(buffer: Buffer, fileName: string): Promise<{ clean: boolean; error?: string }>;
}
