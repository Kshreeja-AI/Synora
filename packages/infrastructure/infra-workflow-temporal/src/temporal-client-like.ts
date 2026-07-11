/** The minimal @temporalio/client surface TemporalWorkflowEngine needs — lets tests inject a fake. */
export interface TemporalClientLike {
  start(
    workflowType: string,
    options: { workflowId: string; taskQueue: string; args: unknown[] },
  ): Promise<{ workflowId: string }>;
  signal(workflowId: string, signalName: string, args: unknown[]): Promise<void>;
  query<Result>(workflowId: string, queryName: string, args: unknown[]): Promise<Result>;
}
