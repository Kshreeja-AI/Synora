import { Client, Connection } from '@temporalio/client';
import type { TemporalClientLike } from './temporal-client-like.js';

export interface TemporalClientOptions {
  address: string;
  namespace?: string;
}

/** Bridges a real @temporalio/client Client to the minimal TemporalClientLike surface. */
export async function createTemporalClient(
  options: TemporalClientOptions,
): Promise<TemporalClientLike> {
  const connection = await Connection.connect({ address: options.address });
  const client = new Client({
    connection,
    ...(options.namespace ? { namespace: options.namespace } : {}),
  });

  return {
    async start(workflowType, startOptions) {
      const handle = await client.workflow.start(workflowType, startOptions);
      return { workflowId: handle.workflowId };
    },
    async signal(workflowId, signalName, args) {
      const handle = client.workflow.getHandle(workflowId);
      await handle.signal(signalName, ...args);
    },
    async query(workflowId, queryName, args) {
      const handle = client.workflow.getHandle(workflowId);
      return handle.query(queryName, ...args);
    },
  };
}
