# @synora/infra-storage-s3

**Infrastructure layer** adapter for `DEFAULT_OBJECT_STORAGE=s3-compatible` /
`DEFAULT_STORAGE_PROVIDER=s3`. `S3ObjectStorage` implements the `ObjectStorage` port from
`@synora/application` against a minimal `S3ClientLike` interface (not the concrete AWS SDK
client), so tests inject a fake instead of needing real S3 credentials. Works against any
S3-compatible endpoint (AWS S3, R2, MinIO, ...) via the injected client's configured
endpoint.
