/**
 * The mapping from "what an executor said it created" to "what the audit
 * row records".
 *
 * Tested directly rather than only through a route because there are TWO
 * places a bound capability runs — directly, and through an approval — and
 * both write these columns from the same function. Only one of those paths
 * is reachable with today's catalogue (nothing `sensitive` declares an undo
 * target), so a route test alone would leave the other call site untested
 * and free to drift.
 */

import { describe, it, expect } from 'vitest';
import { undoColumns } from '../execute';

describe('undoColumns', () => {
  it('records what the executor declared', () => {
    expect(undoColumns({ ok: true, undo: { kind: 'conversation', targetId: 'conv_1' } })).toEqual({
      undoKind: 'conversation',
      undoTargetId: 'conv_1',
    });
  });

  it('records nothing for an action that declared no way back', () => {
    // Most capabilities are like this. Absent is the honest answer, and
    // undo refuses on it rather than improvising a target.
    expect(undoColumns({ ok: true })).toEqual({ undoKind: null, undoTargetId: null });
  });

  it('records nothing for a run that did not succeed', () => {
    // A failed run created nothing, whatever it may have said on the way
    // out. An undo target here would point at something that does not
    // exist — and undo deletes what it is pointed at.
    expect(
      undoColumns({ ok: false, undo: { kind: 'schedule', targetId: 'sched_1' } })
    ).toEqual({ undoKind: null, undoTargetId: null });
  });
});
