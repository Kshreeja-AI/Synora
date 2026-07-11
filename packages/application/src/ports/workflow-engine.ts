/**
 * Port for long-running/durable workflow orchestration (default provider: Temporal —
 * see infra-workflow-temporal). This pass ships a client-side port only; a worker process
 * that actually executes workflow/activity code is a future addition — see ADR-0011.
 */
export interface StartWorkflowOptions {
  readonly workflowId: string;
  readonly taskQueue: string;
}

export interface WorkflowHandle {
  readonly workflowId: string;
}

export interface WorkflowEngine {
  startWorkflow<Input>(
    workflowType: string,
    input: Input,
    options: StartWorkflowOptions,
  ): Promise<WorkflowHandle>;
  signalWorkflow<Payload>(workflowId: string, signalName: string, payload?: Payload): Promise<void>;
  queryWorkflow<Result, Args = undefined>(
    workflowId: string,
    queryName: string,
    args?: Args,
  ): Promise<Result>;
}
