import { prisma } from '@synora/database';
import { registerHealthProbe } from './health-collector.js';

let registered = false;

export function registerDependencyProbes(): void {
  if (registered) return;
  registered = true;

  registerHealthProbe({
    name: 'postgres',
    check: async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return 'healthy';
      } catch {
        return 'down';
      }
    },
  });

  registerHealthProbe({
    name: 'redis',
    check: async () => {
      try {
        const { getRedis } = await import('../queue/redis.js');
        const ok = await getRedis().ping();
        return ok ? 'healthy' : 'down';
      } catch {
        return 'down';
      }
    },
  });
}
