/**
 * Trigger tests.
 *
 * The property that matters most is what the public firing path can and
 * cannot learn: a wrong secret and a secret for a disabled trigger must be
 * indistinguishable from a secret that never existed, and the raw secret
 * itself must never be recoverable from what gets stored or listed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryKeyedStore } from '../../agents/agent-stores';
import {
  createTrigger,
  deleteTrigger,
  getTrigger,
  hashTriggerSecret,
  hydrateTriggers,
  listTriggers,
  persistTrigger,
  resetTriggers,
  resolveTriggerBySecret,
  recordFired,
  setTriggerEnabled,
  setTriggerStore,
  type WorkflowTrigger,
} from '../trigger';

const WS = 'ws_alpha';

beforeEach(() => {
  resetTriggers();
  setTriggerStore(new InMemoryKeyedStore<WorkflowTrigger>());
});

describe('creating a trigger', () => {
  it('returns the raw secret once, and never stores it', () => {
    const { trigger, rawSecret } = createTrigger({
      workspaceId: WS,
      workflowId: 'wf_1',
      createdBy: 'u1',
    });

    expect(rawSecret.startsWith('whk_')).toBe(true);
    expect(trigger.secretHash).toBe(hashTriggerSecret(rawSecret));
    // The object a caller can get back out of the store never carries the
    // raw value, whole or partial beyond the display preview.
    expect(JSON.stringify(trigger)).not.toContain(rawSecret);
    expect(trigger.secretPreview).toBe(rawSecret.slice(0, trigger.secretPreview.length));
    expect(trigger.enabled).toBe(true);
    expect(trigger.firedCount).toBe(0);
  });

  it('generates a distinct secret and id each time', () => {
    const a = createTrigger({ workspaceId: WS, workflowId: 'wf_1', createdBy: 'u1' });
    const b = createTrigger({ workspaceId: WS, workflowId: 'wf_1', createdBy: 'u1' });
    expect(a.rawSecret).not.toBe(b.rawSecret);
    expect(a.trigger.id).not.toBe(b.trigger.id);
  });
});

describe('resolving a presented secret', () => {
  it('resolves a valid, enabled secret to its trigger', () => {
    const { trigger, rawSecret } = createTrigger({
      workspaceId: WS,
      workflowId: 'wf_1',
      createdBy: 'u1',
    });
    expect(resolveTriggerBySecret(rawSecret)?.id).toBe(trigger.id);
  });

  it('treats a wrong secret exactly like no trigger at all', () => {
    createTrigger({ workspaceId: WS, workflowId: 'wf_1', createdBy: 'u1' });
    expect(resolveTriggerBySecret('whk_' + '0'.repeat(64))).toBeNull();
    expect(resolveTriggerBySecret('not-even-the-right-shape')).toBeNull();
  });

  it('a disabled trigger resolves to nothing, indistinguishable from missing', () => {
    const { trigger, rawSecret } = createTrigger({
      workspaceId: WS,
      workflowId: 'wf_1',
      createdBy: 'u1',
    });
    setTriggerEnabled(trigger.id, WS, false);
    // Pausing must not become discoverable to whoever holds the secret.
    expect(resolveTriggerBySecret(rawSecret)).toBeNull();
  });

  it('re-enabling restores resolution', () => {
    const { trigger, rawSecret } = createTrigger({
      workspaceId: WS,
      workflowId: 'wf_1',
      createdBy: 'u1',
    });
    setTriggerEnabled(trigger.id, WS, false);
    setTriggerEnabled(trigger.id, WS, true);
    expect(resolveTriggerBySecret(rawSecret)?.id).toBe(trigger.id);
  });

  it('a deleted trigger cannot be fired even with the correct secret', () => {
    const { trigger, rawSecret } = createTrigger({
      workspaceId: WS,
      workflowId: 'wf_1',
      createdBy: 'u1',
    });
    deleteTrigger(trigger.id, WS);
    expect(resolveTriggerBySecret(rawSecret)).toBeNull();
  });
});

describe('lookup and listing', () => {
  it('scopes getTrigger to the workspace', () => {
    const { trigger } = createTrigger({ workspaceId: WS, workflowId: 'wf_1', createdBy: 'u1' });
    expect(getTrigger(trigger.id, 'ws_other')).toBeNull();
    expect(getTrigger(trigger.id, WS)?.id).toBe(trigger.id);
  });

  it('lists only a workspace\'s triggers, optionally filtered by workflow', () => {
    createTrigger({ workspaceId: WS, workflowId: 'wf_1', createdBy: 'u1' });
    createTrigger({ workspaceId: WS, workflowId: 'wf_2', createdBy: 'u1' });
    createTrigger({ workspaceId: 'ws_other', workflowId: 'wf_1', createdBy: 'u1' });

    expect(listTriggers(WS)).toHaveLength(2);
    expect(listTriggers(WS, 'wf_1')).toHaveLength(1);
    expect(listTriggers('ws_other')).toHaveLength(1);
  });
});

describe('recording a fire', () => {
  it('increments firedCount and stamps lastFiredAt', () => {
    const { trigger } = createTrigger({ workspaceId: WS, workflowId: 'wf_1', createdBy: 'u1' });
    recordFired(trigger.id, 1000);
    recordFired(trigger.id, 2000);
    expect(getTrigger(trigger.id, WS)).toMatchObject({ firedCount: 2, lastFiredAt: 2000 });
  });

  it('never throws for an id that no longer exists', () => {
    expect(() => recordFired('trg_missing')).not.toThrow();
  });
});

describe('durability', () => {
  it('round-trips through persist and hydrate, secret hash included', async () => {
    const { trigger, rawSecret } = createTrigger({
      workspaceId: WS,
      workflowId: 'wf_1',
      createdBy: 'u1',
    });
    await persistTrigger(trigger.id);

    resetTriggers();
    const loaded = await hydrateTriggers();

    expect(loaded).toBe(1);
    expect(resolveTriggerBySecret(rawSecret)?.id).toBe(trigger.id);
  });

  it('discards a stored record missing required fields rather than repairing it', async () => {
    const store = new InMemoryKeyedStore<WorkflowTrigger>();
    setTriggerStore(store);
    await store.save('trg_bad', { id: 'trg_bad' } as WorkflowTrigger);

    const loaded = await hydrateTriggers();
    expect(loaded).toBe(0);
  });
});
