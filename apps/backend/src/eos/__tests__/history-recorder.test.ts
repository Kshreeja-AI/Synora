import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import {
  buildSnapshot,
  captureSnapshot,
  queryHistory,
  setHistoryStore,
  getHistoryStore,
  startHistoryRecorder,
  stopHistoryRecorder,
} from '../history-recorder';
import { InMemoryHistoryStore, type EngineeringHistoryStore, type EngineeringSnapshot } from '../history-store';
import { recordLatency, stopLatencyTracker } from '../latency-tracker';
import { recordProviderObservation, stopProviderObservatory } from '../provider-observatory';
import { recordPromptOutcome, stopPromptIntelligence } from '../prompt-intelligence';

describe('history-recorder', () => {
  beforeEach(() => {
    stopHistoryRecorder();
    stopLatencyTracker();
    stopProviderObservatory();
    stopPromptIntelligence();
    setHistoryStore(new InMemoryHistoryStore());
  });

  afterEach(() => {
    stopHistoryRecorder();
  });

  it('defaults to an in-memory store', () => {
    expect(getHistoryStore().kind).toBe('memory');
  });

  it('builds a snapshot containing live collector state', () => {
    recordLatency(100);
    recordLatency(200);
    recordProviderObservation({
      providerId: 'anthropic',
      modelId: 'claude-x',
      latencyMs: 500,
      inputTokens: 100,
      outputTokens: 50,
      costCents: 3,
      success: true,
    });
    recordPromptOutcome({ promptId: 'summarize', success: true, latencyMs: 80 });

    const snap = buildSnapshot();

    expect(snap.capturedAt).toBeGreaterThan(0);
    expect(snap.latency.count).toBe(2);
    expect(snap.memory!.rssMb).toBeGreaterThan(0);
    expect(snap.providers).toHaveLength(1);
    expect(snap.providers[0].providerId).toBe('anthropic');
    expect(snap.prompts).toHaveLength(1);
    expect(snap.prompts[0].promptId).toBe('summarize');
    expect(snap.eventBus.bufferSize).toBeGreaterThan(0);
  });

  it('captureSnapshot persists to the store and is retrievable', async () => {
    const captured = await captureSnapshot();
    expect(captured).not.toBeNull();

    const history = await queryHistory();
    expect(history).toHaveLength(1);
    expect(history[0].capturedAt).toBe(captured!.capturedAt);
  });

  it('captureSnapshot emits an engineering.snapshot event', async () => {
    const events: unknown[] = [];
    const unsub = engineeringEventBus.on('engineering.snapshot', (e) => events.push(e));

    recordPromptOutcome({ promptId: 'p', success: true, latencyMs: 10 });
    await captureSnapshot();

    expect(events).toHaveLength(1);
    const event = events[0] as { payload: { store: string; promptCount: number } };
    expect(event.payload.store).toBe('memory');
    expect(event.payload.promptCount).toBe(1);
    unsub();
  });

  it('a failing store never propagates an error to the caller', async () => {
    const brokenStore: EngineeringHistoryStore = {
      kind: 'broken',
      append: async () => {
        throw new Error('disk full');
      },
      query: async () => {
        throw new Error('unreadable');
      },
      count: async () => {
        throw new Error('unreadable');
      },
    };
    setHistoryStore(brokenStore);

    // Observability must never be able to break the product.
    await expect(captureSnapshot()).resolves.toBeNull();
    await expect(queryHistory()).resolves.toEqual([]);
  });

  it('records snapshots on the configured interval', async () => {
    vi.useFakeTimers();
    try {
      startHistoryRecorder(1000);
      await vi.advanceTimersByTimeAsync(3000);
    } finally {
      vi.useRealTimers();
    }

    const history = await queryHistory();
    expect(history.length).toBeGreaterThanOrEqual(3);
  });

  it('startHistoryRecorder is idempotent', async () => {
    vi.useFakeTimers();
    try {
      startHistoryRecorder(1000);
      startHistoryRecorder(1000);
      await vi.advanceTimersByTimeAsync(1000);
    } finally {
      vi.useRealTimers();
    }

    // A second start must not double the capture rate.
    const history = await queryHistory();
    expect(history).toHaveLength(1);
  });

  it('supports time-range queries over recorded history', async () => {
    const store = new InMemoryHistoryStore();
    setHistoryStore(store);
    const base = Date.now();
    for (const offset of [0, 1000, 2000]) {
      await store.append({ ...(buildSnapshot() as EngineeringSnapshot), capturedAt: base + offset });
    }

    const recent = await queryHistory({ since: base + 1000 });
    expect(recent).toHaveLength(2);
  });
});
