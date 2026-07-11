import type { SynoraConfig } from '@synora/config';
import type { AgentDefinition } from '@synora/core';
import type { ToolRegistry } from '@synora/tools';
import { AgentIds } from './agent-ids.js';

/**
 * Builds Kshreeja AI's three agents. This is the entirety of what
 * makes Kshreeja AI a distinct product: personas, tool grants, and
 * handoff topology, expressed purely as data over platform ports. None
 * of it lives in, or leaks into, the platform packages.
 */
export function buildKshreejaAgents(config: SynoraConfig, tools: ToolRegistry): AgentDefinition[] {
  const providerId = config.DEFAULT_MODEL_PROVIDER;
  const model = config.DEFAULT_MODEL;

  const coordinator: AgentDefinition = {
    id: AgentIds.Coordinator,
    name: 'Kshreeja Coordinator',
    description: "Understands the user's request and routes it to the right specialist agent.",
    instructions: [
      'You are the entry point for Kshreeja AI, a research-and-writing assistant.',
      'For requests that need factual research or gathering information, hand off to the researcher agent.',
      'For requests that need drafting, editing, or formatting prose, hand off to the writer agent.',
      'For simple questions you can answer directly without research, answer directly.',
    ].join(' '),
    providerId,
    model,
    tools: [],
    memoryEnabled: true,
    handoffTargets: [AgentIds.Researcher, AgentIds.Writer],
    inputGuardrails: [{ name: 'prompt-injection' }],
  };

  const researcher: AgentDefinition = {
    id: AgentIds.Researcher,
    name: 'Kshreeja Researcher',
    description: 'Gathers and summarizes information relevant to the request.',
    instructions:
      'You research topics thoroughly and produce concise, well-organized notes with the key facts. ' +
      'Use the current_time tool if the request is time-sensitive. Hand off to the writer agent once your notes are ready.',
    providerId,
    model,
    tools: tools.definitions(['current_time']),
    memoryEnabled: true,
    handoffTargets: [AgentIds.Writer],
  };

  const writer: AgentDefinition = {
    id: AgentIds.Writer,
    name: 'Kshreeja Writer',
    description: 'Turns research notes into clear, well-structured prose.',
    instructions:
      'You write clear, well-structured responses for the end user based on the conversation so far. ' +
      'Use the calculator tool for any arithmetic rather than computing it yourself.',
    providerId,
    model,
    tools: tools.definitions(['calculator']),
    memoryEnabled: true,
    outputGuardrails: [{ name: 'pii' }, { name: 'secret-leak' }],
  };

  return [coordinator, researcher, writer];
}
