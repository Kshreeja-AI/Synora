import { asAgentId } from '@synora/core';

export const AgentIds = {
  Coordinator: asAgentId('kshreeja.coordinator'),
  Researcher: asAgentId('kshreeja.researcher'),
  Writer: asAgentId('kshreeja.writer'),
} as const;
