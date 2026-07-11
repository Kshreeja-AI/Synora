import type { StartWorkflowOptions, WorkflowEngine, WorkflowHandle } from '@synora/application';
import type { TemporalClientLike } from './temporal-client-like.js';

export class TemporalWorkflowEngine implements WorkflowEngine {
  constructor(private readonly client: TemporalClientLike) {}

  async startWorkflow<Input>(
    workflowType: string,
    input: Input,
    options: StartWorkflowOptions,
  ): Promise<WorkflowHandle> {
    const handle = await this.client.start(workflowType, {
      workflowId: options.workflowId,
      taskQueue: options.taskQueue,
      args: [input],
    });
    return { workflowId: handle.workflowId };
  }

  async signalWorkflow<Payload>(
    workflowId: string,
    signalName: string,
    payload?: Payload,
  ): Promise<void> {
    await this.client.signal(workflowId, signalName, payload === undefined ? [] : [payload]);
  }

  async queryWorkflow<Result, Args = undefined>(
    workflowId: string,
    queryName: string,
    args?: Args,
  ): Promise<Result> {
    return this.client.query<Result>(workflowId, queryName, args === undefined ? [] : [args]);
  }
}
