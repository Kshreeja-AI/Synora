import { describe, expect, it, vi } from 'vitest';
import { S3ObjectStorage } from './s3-object-storage.js';
import type { S3ClientLike } from './s3-client-like.js';

function makeFakeClient(): S3ClientLike {
  const store = new Map<string, Uint8Array>();
  return {
    putObject: vi.fn(async ({ key, body }) => {
      store.set(key, body);
    }),
    getObject: vi.fn(async ({ key }) => store.get(key)),
    deleteObject: vi.fn(async ({ key }) => {
      store.delete(key);
    }),
    getSignedUrl: vi.fn(async ({ bucket, key }) => `https://example.com/${bucket}/${key}`),
  };
}

describe('S3ObjectStorage', () => {
  it('scopes every call to the configured bucket', async () => {
    const client = makeFakeClient();
    const storage = new S3ObjectStorage(client, 'my-bucket');

    const body = new TextEncoder().encode('hello');
    await storage.putObject('docs/hello.txt', body, 'text/plain');

    expect(client.putObject).toHaveBeenCalledWith({
      bucket: 'my-bucket',
      key: 'docs/hello.txt',
      body,
      contentType: 'text/plain',
    });
  });

  it('round-trips put/get/delete', async () => {
    const storage = new S3ObjectStorage(makeFakeClient(), 'my-bucket');
    const body = new TextEncoder().encode('payload');

    await storage.putObject('a.bin', body);
    expect(await storage.getObject('a.bin')).toEqual(body);

    await storage.deleteObject('a.bin');
    expect(await storage.getObject('a.bin')).toBeUndefined();
  });

  it('builds a signed url scoped to bucket and key', async () => {
    const storage = new S3ObjectStorage(makeFakeClient(), 'my-bucket');
    expect(await storage.getSignedUrl('a.bin', 60)).toBe('https://example.com/my-bucket/a.bin');
  });
});
