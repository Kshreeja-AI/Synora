import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BURST_LIMIT,
  claimBurstSlot,
  createEventTrigger,
  deleteEventTrigger,
  getEventTrigger,
  hydrateEventTriggers,
  listEventTriggers,
  matchesFilter,
  resetEventTriggers,
  setEventTriggerEnabled,
  setEventTriggerStore,
  triggersFor,
  WORKFLOW_EVENTS,
  type EventTrigger,
  type WorkflowEvent,
} from '../event-trigger';
import { InMemoryKeyedStore } from '../../agents/agent-stores';

/**
 * Event triggers: a workflow starting because something happened inside
 * Synora.
 *
 * The assertions worth having are the ones that keep an automation from
 * being either silently dead or quietly expensive: an event nobody emits
 * is refused rather than stored, a disabled trigger matches nothing, and a
 * busy workspace cannot turn one careless wiring into hundreds of runs.
 */

function event(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
  return {
    name: 'asset.uploaded',
    workspaceId: 'ws_1',
    actorId: 'u_actor',
    subjectId: 'asset_1',
    subjectName: 'quarterly.pdf',
    mimeType: 'application/pdf',
    ...overrides,
  };
}

function makeTrigger(overrides: Partial<Parameters<typeof createEventTrigger>[0]> = {}) {
  return createEventTrigger({
    workspaceId: 'ws_1',
    workflowId: 'wf_1',
    event: 'asset.uploaded',
    createdBy: 'u_owner',
    ...overrides,
  });
}

beforeEach(() => {
  resetEventTriggers();
  setEventTriggerStore(new InMemoryKeyedStore<EventTrigger>());
});

describe('event triggers', () => {
  it('refuses an event name the platform does not emit, by name', () => {
    // The failure this prevents: a trigger listening for `document.changed`
    // would sit enabled forever while nobody ever emits it, and the person
    // who wired it has no way to tell that from a broken workflow.
    expect(() => makeTrigger({ event: 'document.changed' as never })).toThrow(
      /unknown event "document\.changed"/,
    );
    // And it says what does exist, rather than leaving them to guess.
    expect(() => makeTrigger({ event: 'nope' as never })).toThrow(/asset\.uploaded/);
  });

  it('every catalogued event is one a trigger can be made for', () => {
    for (const name of WORKFLOW_EVENTS) {
      expect(() => makeTrigger({ event: name })).not.toThrow();
    }
  });

  it('matches a trigger to an event in the same workspace only', () => {
    const mine = makeTrigger();
    makeTrigger({ workspaceId: 'ws_2' });

    const matched = triggersFor(event());
    expect(matched.map((t) => t.id)).toEqual([mine.id]);
  });

  it('does not match a disabled trigger', () => {
    const trigger = makeTrigger();
    setEventTriggerEnabled(trigger.id, 'ws_1', false);

    // Pausing an automation has to actually pause it, or the switch is
    // decorative.
    expect(triggersFor(event())).toEqual([]);
  });

  it('does not match a different event', () => {
    makeTrigger({ event: 'project.created' });
    expect(triggersFor(event({ name: 'asset.uploaded' }))).toEqual([]);
  });

  describe('filters', () => {
    it('matches everything when there is no filter', () => {
      const trigger = makeTrigger();
      expect(matchesFilter(trigger, event())).toBe(true);
      expect(matchesFilter(trigger, event({ mimeType: 'image/png' }))).toBe(true);
    });

    it('narrows by project', () => {
      const trigger = makeTrigger({ filter: { projectId: 'proj_1' } });
      expect(matchesFilter(trigger, event({ projectId: 'proj_1' }))).toBe(true);
      expect(matchesFilter(trigger, event({ projectId: 'proj_2' }))).toBe(false);
      // An event with no project does not match a project filter, rather
      // than matching by accident.
      expect(matchesFilter(trigger, event({ projectId: undefined }))).toBe(false);
    });

    it('narrows by mime type prefix', () => {
      const trigger = makeTrigger({ filter: { mimeTypePrefix: 'image/' } });
      expect(matchesFilter(trigger, event({ mimeType: 'image/png' }))).toBe(true);
      expect(matchesFilter(trigger, event({ mimeType: 'application/pdf' }))).toBe(false);
    });

    it('requires every condition, not any', () => {
      const trigger = makeTrigger({
        filter: { projectId: 'proj_1', mimeTypePrefix: 'image/' },
      });
      // Right project, wrong type: still no.
      expect(matchesFilter(trigger, event({ projectId: 'proj_1', mimeType: 'text/csv' }))).toBe(
        false,
      );
      expect(matchesFilter(trigger, event({ projectId: 'proj_1', mimeType: 'image/png' }))).toBe(
        true,
      );
    });
  });

  describe('the burst limit', () => {
    it('allows a normal amount of activity and then stops', () => {
      const trigger = makeTrigger();
      for (let i = 0; i < BURST_LIMIT; i += 1) {
        expect(claimBurstSlot(trigger.id)).toBe(true);
      }
      // The blast radius of a mistake: somebody dragging four hundred files
      // into a workspace must not start four hundred runs against real
      // budget before anyone notices.
      expect(claimBurstSlot(trigger.id)).toBe(false);
    });

    it('counts what it refused, separately from what it ran', () => {
      const trigger = makeTrigger();
      for (let i = 0; i < BURST_LIMIT + 3; i += 1) claimBurstSlot(trigger.id);

      // "Nothing happened" and "something happened and was declined" are
      // different things to debug.
      expect(getEventTrigger(trigger.id, 'ws_1')?.suppressedCount).toBe(3);
      expect(getEventTrigger(trigger.id, 'ws_1')?.firedCount).toBe(0);
    });

    it('lets the window slide rather than blocking forever', () => {
      const trigger = makeTrigger();
      const start = Date.now();
      for (let i = 0; i < BURST_LIMIT; i += 1) claimBurstSlot(trigger.id, start);
      expect(claimBurstSlot(trigger.id, start)).toBe(false);

      // A minute later the workspace is not still being punished for a
      // busy moment.
      expect(claimBurstSlot(trigger.id, start + 60_001)).toBe(true);
    });

    it('budgets each trigger on its own', () => {
      const a = makeTrigger();
      const b = makeTrigger({ workflowId: 'wf_2' });
      for (let i = 0; i < BURST_LIMIT; i += 1) claimBurstSlot(a.id);

      // One noisy automation must not silence an unrelated one.
      expect(claimBurstSlot(b.id)).toBe(true);
    });
  });

  describe('lookup and lifecycle', () => {
    it('scopes reads by workspace', () => {
      const trigger = makeTrigger();
      expect(getEventTrigger(trigger.id, 'ws_1')).not.toBeNull();
      expect(getEventTrigger(trigger.id, 'ws_2')).toBeNull();
      expect(listEventTriggers('ws_2')).toEqual([]);
    });

    it('refuses to delete another workspace\'s trigger', () => {
      const trigger = makeTrigger();
      expect(deleteEventTrigger(trigger.id, 'ws_2')).toBe(false);
      expect(getEventTrigger(trigger.id, 'ws_1')).not.toBeNull();
      expect(deleteEventTrigger(trigger.id, 'ws_1')).toBe(true);
    });

    it('discards a stored trigger listening for an event this version no longer emits', async () => {
      const store = new InMemoryKeyedStore<EventTrigger>();
      await store.save('evt_good', {
        id: 'evt_good',
        workspaceId: 'ws_1',
        workflowId: 'wf_1',
        event: 'asset.uploaded',
        enabled: true,
        createdBy: 'u_owner',
        createdAt: 1,
        firedCount: 0,
        suppressedCount: 0,
      });
      await store.save('evt_stale', {
        id: 'evt_stale',
        workspaceId: 'ws_1',
        workflowId: 'wf_1',
        event: 'document.changed' as never,
        enabled: true,
        createdBy: 'u_owner',
        createdAt: 1,
        firedCount: 0,
        suppressedCount: 0,
      });
      setEventTriggerStore(store);

      // Discarded rather than restored: it would sit enabled and silent,
      // which looks like a working automation and is not one.
      expect(await hydrateEventTriggers()).toBe(1);
      expect(listEventTriggers('ws_1').map((t) => t.id)).toEqual(['evt_good']);
    });
  });
});

describe('event dispatch', () => {
  it('runs nothing, and loads nothing, when no trigger is listening', async () => {
    const { dispatchWorkflowEvent } = await import('../event-dispatch');
    // No throw and no run: the common case for most workspaces, and it
    // must not drag the workflow engine into an upload's import graph.
    await expect(dispatchWorkflowEvent(event())).resolves.toBeUndefined();
  });

  /**
   * The run starter is mocked, not the registry.
   *
   * `vi.resetModules()` must NOT be used here: the dispatcher reads the
   * trigger registry, and resetting the module graph would hand it a
   * second, empty copy — the assertions would then pass or fail for
   * reasons that have nothing to do with dispatch. `doMock` alone is
   * enough because the dispatcher imports the starter lazily, at call
   * time, which is after the mock is registered.
   */
  it('starts a run as the trigger\'s creator, never as whoever caused the event', async () => {
    const trigger = makeTrigger({ createdBy: 'u_owner' });
    // Typed so the recorded call can be read back: an untyped spy records
    // its arguments as an empty tuple.
    const started = vi.fn(async (_input: { requestedBy: string; task: string }) => ({
      id: 'run_1',
      state: 'succeeded',
    }));
    vi.doMock('../triggered-run', () => ({ startTriggeredWorkflowRun: started }));

    const { dispatchWorkflowEvent } = await import('../event-dispatch');
    await dispatchWorkflowEvent(event({ actorId: 'u_someone_else' }));

    // Somebody uploading a file to a shared workspace has not agreed to
    // lend their permissions to an automation another member wired up.
    expect(started).toHaveBeenCalledWith(
      expect.objectContaining({ requestedBy: 'u_owner', workflowId: trigger.workflowId }),
    );
    // The task line names the file, and carries no file content: a run's
    // task reaches a model, and uploading something is not agreeing to
    // send it to a provider.
    expect(started.mock.calls[0][0].task).toContain('quarterly.pdf');
    vi.doUnmock('../triggered-run');
  });

  it('does not let a broken automation fail the action that caused it', async () => {
    makeTrigger();
    const started = vi.fn(async () => {
      throw new Error('workflow not found');
    });
    vi.doMock('../triggered-run', () => ({ startTriggeredWorkflowRun: started }));

    const { dispatchWorkflowEvent } = await import('../event-dispatch');
    // Someone uploading a file asked to upload a file. An automation
    // pointing at an archived workflow is not their problem and must not
    // become their error message.
    await expect(dispatchWorkflowEvent(event())).resolves.toBeUndefined();
    // Proves the failure was reached and swallowed, rather than the
    // dispatcher having quietly matched nothing.
    expect(started).toHaveBeenCalled();
    vi.doUnmock('../triggered-run');
  });

  it('does not start a run once the burst budget is spent', async () => {
    const trigger = makeTrigger();
    const started = vi.fn(async () => ({ id: 'run_1', state: 'succeeded' }));
    vi.doMock('../triggered-run', () => ({ startTriggeredWorkflowRun: started }));
    for (let i = 0; i < BURST_LIMIT; i += 1) claimBurstSlot(trigger.id);

    const { dispatchWorkflowEvent } = await import('../event-dispatch');
    await dispatchWorkflowEvent(event());

    // Suppression has to stop the run, not merely count it.
    expect(started).not.toHaveBeenCalled();
    expect(getEventTrigger(trigger.id, 'ws_1')?.suppressedCount).toBe(1);
    vi.doUnmock('../triggered-run');
  });
});
