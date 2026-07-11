import type { AgentId } from './ids.js';

export type StepKind = 'agent' | 'tool' | 'parallel' | 'sequence' | 'condition';

export interface AgentStep {
  kind: 'agent';
  id: string;
  agentId: AgentId;
  inputFrom?: string;
}

export interface ToolStep {
  kind: 'tool';
  id: string;
  toolName: string;
  inputFrom?: string;
}

export interface ParallelStep {
  kind: 'parallel';
  id: string;
  branches: WorkflowStep[];
}

export interface SequenceStep {
  kind: 'sequence';
  id: string;
  steps: WorkflowStep[];
}

export interface ConditionStep {
  kind: 'condition';
  id: string;
  predicate: string;
  ifTrue: WorkflowStep;
  ifFalse?: WorkflowStep;
}

export type WorkflowStep = AgentStep | ToolStep | ParallelStep | SequenceStep | ConditionStep;

/**
 * A declarative, serializable multi-agent workflow graph. Kept as data
 * (not code) so workflows can be authored per-product, stored, and
 * versioned without touching the orchestration engine.
 */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  entry: WorkflowStep;
  metadata?: Record<string, unknown>;
}

export type WorkflowRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowStepTrace {
  stepId: string;
  kind: StepKind;
  startedAt: string;
  completedAt?: string;
  output?: unknown;
  error?: string;
}

export interface WorkflowRunResult {
  status: WorkflowRunStatus;
  output: unknown;
  trace: WorkflowStepTrace[];
}
