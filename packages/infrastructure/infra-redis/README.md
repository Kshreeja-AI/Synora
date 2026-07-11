# @synora/infra-redis

**Infrastructure layer** adapter for `DEFAULT_CACHE=redis` and `DEFAULT_QUEUE=redis`.
Ships two adapters over one `ioredis` connection: `RedisCache` (implements
`Cache` from `@synora/application`) and `RedisQueue` (implements `Queue`).

Both classes take a minimal client interface (`RedisLike`), not the concrete `ioredis`
type, so tests inject an in-memory fake instead of needing a live Redis server — see
`*.test.ts` in this package.
