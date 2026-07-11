import type { FastifyInstance } from 'fastify';
import type { ApiResponse } from '@synora/types';

interface HealthPayload {
  status: 'ok';
  version: string;
}

export function registerHealthRoute(app: FastifyInstance, version: string): void {
  app.get('/health', async () => {
    const body: ApiResponse<HealthPayload> = { success: true, data: { status: 'ok', version } };
    return body;
  });
}
