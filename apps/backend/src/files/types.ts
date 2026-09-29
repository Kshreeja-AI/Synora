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

/**
 * The outcome of attempting to scan a file. Deliberately NOT a boolean:
 * a boolean forces "couldn't scan" to be reported as either clean (a
 * dangerous lie) or infected (a false alarm). The three real outcomes —
 * clean, infected, or "the scan did not conclude" — must each be
 * representable so the file pipeline can record the truth.
 */
export type ScanOutcome =
  | { status: 'clean' }
  | { status: 'infected'; signature: string }
  | { status: 'error'; error: string };

export interface VirusScanProvider {
  readonly id: string;
  scan(buffer: Buffer, fileName: string): Promise<ScanOutcome>;
}

/**
 * A virus-scan provider the platform knows how to use. Mirrors the
 * descriptor pattern of the AI, embeddings, vectordb, mail and storage
 * subsystems: `isConfigured()` is a cheap, no-network check of whether
 * this provider's config is present, used for capability detection and
 * auto-selection.
 */
export interface VirusScanProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): Promise<boolean>;
  create(): Promise<VirusScanProvider>;
}
