/** The minimal S3 surface S3ObjectStorage needs — lets tests inject a fake instead of real AWS credentials. */
export interface S3ClientLike {
  putObject(params: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType?: string;
  }): Promise<void>;
  getObject(params: { bucket: string; key: string }): Promise<Uint8Array | undefined>;
  deleteObject(params: { bucket: string; key: string }): Promise<void>;
  getSignedUrl(params: { bucket: string; key: string; expiresInSeconds: number }): Promise<string>;
}
