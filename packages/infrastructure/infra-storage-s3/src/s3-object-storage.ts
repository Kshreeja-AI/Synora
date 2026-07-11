import type { ObjectStorage } from '@synora/application';
import type { S3ClientLike } from './s3-client-like.js';

export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: S3ClientLike,
    private readonly bucket: string,
  ) {}

  async putObject(key: string, body: Uint8Array, contentType?: string): Promise<void> {
    await this.client.putObject({
      bucket: this.bucket,
      key,
      body,
      ...(contentType ? { contentType } : {}),
    });
  }

  async getObject(key: string): Promise<Uint8Array | undefined> {
    return this.client.getObject({ bucket: this.bucket, key });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.deleteObject({ bucket: this.bucket, key });
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return this.client.getSignedUrl({ bucket: this.bucket, key, expiresInSeconds });
  }
}
