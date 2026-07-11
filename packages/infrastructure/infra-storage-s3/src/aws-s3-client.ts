import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3ClientLike } from './s3-client-like.js';

export interface AwsS3ClientOptions {
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  forcePathStyle?: boolean;
}

/** Real S3ClientLike adapter over @aws-sdk/client-s3 — works against any S3-compatible endpoint. */
export function createAwsS3Client(options: AwsS3ClientOptions): S3ClientLike {
  const client = new S3Client({
    region: options.region,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    ...(options.credentials ? { credentials: options.credentials } : {}),
    ...(options.forcePathStyle !== undefined ? { forcePathStyle: options.forcePathStyle } : {}),
  });

  return {
    async putObject({ bucket, key, body, contentType }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ...(contentType ? { ContentType: contentType } : {}),
        }),
      );
    },
    async getObject({ bucket, key }) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body) return undefined;
      return result.Body.transformToByteArray();
    },
    async deleteObject({ bucket, key }) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async getSignedUrl({ bucket, key, expiresInSeconds }) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },
  };
}
