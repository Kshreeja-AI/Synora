import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../utils/logger';
import { startSpan, endSpan, endSpanWithError, withSpan } from '../tracing';

describe('tracing', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => logger);
  });

  afterEach(() => {
    debugSpy.mockRestore();
  });

  it('gives every span a unique id', () => {
    const a = startSpan('op');
    const b = startSpan('op');
    expect(a.spanId).not.toBe(b.spanId);
  });

  it('carries the caller-supplied attributes through to the start log', () => {
    startSpan('ai.generateText', { providerId: 'anthropic', model: 'claude-sonnet-5' });

    expect(debugSpy).toHaveBeenCalledWith(
      '[Trace] span started',
      expect.objectContaining({ providerId: 'anthropic', model: 'claude-sonnet-5' })
    );
  });

  it('reports a non-negative duration on a normal end', () => {
    const span = startSpan('op');
    endSpan(span);

    const [, payload] = debugSpy.mock.calls.find(([msg]) => msg === '[Trace] span ended')!;
    expect((payload as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records the error message on a failed span, not just that it failed', () => {
    const span = startSpan('op');
    endSpanWithError(span, new Error('upstream 500'));

    expect(debugSpy).toHaveBeenCalledWith(
      '[Trace] span ended with error',
      expect.objectContaining({ error: 'upstream 500' })
    );
  });

  it('withSpan returns the wrapped result and logs a normal end on success', async () => {
    const result = await withSpan('op', {}, async () => 'value');

    expect(result).toBe('value');
    expect(debugSpy).toHaveBeenCalledWith('[Trace] span ended', expect.anything());
  });

  it('withSpan rethrows unchanged and logs the error end on failure', async () => {
    const error = new Error('boom');

    await expect(withSpan('op', {}, async () => { throw error; })).rejects.toBe(error);
    expect(debugSpy).toHaveBeenCalledWith(
      '[Trace] span ended with error',
      expect.objectContaining({ error: 'boom' })
    );
  });
});
