import type { DomainEvent, TenantId } from '@synora/core';
import { v4 as uuidv4 } from 'uuid';

export function makeEvent<TPayload>(input: {
  type: string;
  tenantId: TenantId;
  payload: TPayload;
  source: string;
  correlationId?: string;
  causationId?: string;
}): DomainEvent<TPayload> {
  return {
    id: uuidv4(),
    type: input.type,
    tenantId: input.tenantId,
    occurredAt: new Date().toISOString(),
    payload: input.payload,
    source: input.source,
    correlationId: input.correlationId,
    causationId: input.causationId,
  };
}
