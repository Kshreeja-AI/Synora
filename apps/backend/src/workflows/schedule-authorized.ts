import { requireMembership } from '../services/checks';
import { requirePermission } from '../services/permissions';
import { getWorkflow } from './workflow-registry';
import {
  createSchedule,
  persistSchedule,
  type CreateScheduleInput,
  type WorkflowSchedule,
} from './schedule';

/**
 * Schedule creation WITH its own authorization — the authoritative check
 * at the moment of execution, in the same shape `conversationService.create`
 * already has.
 *
 * WHY THIS FILE EXISTS. The HTTP route enforces `tool:manage` through
 * middleware, but the command layer does not travel through HTTP — a bound
 * executor calls services directly, and the engine-level `createSchedule`
 * deliberately has no idea who is asking. Without this wrapper the command
 * path's ONLY permission check would be the catalogue-derived courtesy
 * answer, which the whole layer is built on never trusting as a substitute.
 *
 * It also gives the permission-differential test a real, HTTP-free surface
 * to probe: a VIEWER calling this must be refused by THIS code, not by a
 * middleware the probe never touches.
 */
export async function createScheduleAuthorized(
  userId: string,
  workspaceId: string,
  input: Omit<CreateScheduleInput, 'workspaceId' | 'createdBy'>
): Promise<WorkflowSchedule> {
  const membership = await requireMembership(userId, workspaceId);
  requirePermission(membership.role, 'tool:manage');

  // Workspace-scoped lookup: a workflow id from another workspace is
  // indistinguishable from one that does not exist.
  const workflow = getWorkflow(input.workflowId, workspaceId);
  if (!workflow) throw new Error('workflow not found');
  if (workflow.archived) throw new Error('this workflow is archived and cannot be scheduled');

  const schedule = createSchedule({ ...input, workspaceId, createdBy: userId });
  // Written through before returning, so a caller holding the schedule id
  // is holding something durable — the route's own 201 discipline.
  await persistSchedule(schedule.id);
  return schedule;
}
