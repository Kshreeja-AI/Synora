import type { MetricsRecorder } from '@synora/core';

interface MetricSample {
  value: number;
  tags?: Record<string, string>;
}

/**
 * In-process metrics recorder. Sufficient for local dev, tests, and as
 * a fallback; production deployments can swap this for an OTLP/StatsD
 * implementation behind the same MetricsRecorder port without callers
 * changing.
 */
export class InMemoryMetricsRecorder implements MetricsRecorder {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, MetricSample[]>();
  private readonly gauges = new Map<string, number>();

  private key(name: string, tags?: Record<string, string>): string {
    if (!tags || Object.keys(tags).length === 0) return name;
    const sortedTags = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}{${sortedTags}}`;
  }

  incrementCounter(name: string, value = 1, tags?: Record<string, string>): void {
    const key = this.key(name, tags);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  recordHistogram(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.key(name, tags);
    const samples = this.histograms.get(key) ?? [];
    samples.push({ value, tags });
    this.histograms.set(key, samples);
  }

  setGauge(name: string, value: number, tags?: Record<string, string>): void {
    this.gauges.set(this.key(name, tags), value);
  }

  snapshot() {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(
        Array.from(this.histograms.entries()).map(([k, samples]) => [
          k,
          {
            count: samples.length,
            sum: samples.reduce((acc, s) => acc + s.value, 0),
            p50: percentile(
              samples.map((s) => s.value),
              0.5,
            ),
            p95: percentile(
              samples.map((s) => s.value),
              0.95,
            ),
            p99: percentile(
              samples.map((s) => s.value),
              0.99,
            ),
          },
        ]),
      ),
    };
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index] ?? 0;
}
