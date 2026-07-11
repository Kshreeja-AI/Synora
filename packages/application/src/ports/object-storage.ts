/** Port for binary object storage (default provider: S3-compatible — see infra-storage-s3). */
export interface ObjectStorage {
  putObject(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  getObject(key: string): Promise<Uint8Array | undefined>;
  deleteObject(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}
