import { requireMembership } from '../services/checks';
import { requirePermission } from '../services/permissions';
import { getWorkflow } from './workflow-registry';
import {
  createSchedule,
  deleteSchedule,
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

/**
 * Schedule deletion WITH its own authorization, for exactly the reason the
 * creation wrapper above exists.
 *
 * The engine-level `deleteSchedule` takes a workspace id and checks nothing
 * else — it cannot, because it does not know who is asking. The HTTP route
 * supplies `tool:manage` through middleware. The command layer's undo path
 * never travels through that middleware, so without this it would delete a
 * schedule on the authority of nothing at all.
 *
 * THE PERMISSION IS RE-CHECKED AT DELETE TIME, not inherited from whoever
 * created the schedule. Someone demoted since then must not still be able
 * to remove it, and undo is not a back door around a role change.
 */
export async function deleteScheduleAuthorized(
  userId: string,
  workspaceId: string,
  scheduleId: string
): Promise<boolean> {
  const membership = await requireMembership(userId, workspaceId);
  requirePermission(membership.role, 'tool:manage');

  // Workspace-scoped inside `deleteSchedule`: a schedule id belonging to
  // another workspace deletes nothing and returns false, which is the same
  // answer as an id that never existed.
  // Removes the durable record too — see `deleteSchedule`. An undo that
  // only holds until the process recycles is worse than no undo, because
  // nobody is watching for the thing to come back.
  return deleteSchedule(scheduleId, workspaceId);
}
