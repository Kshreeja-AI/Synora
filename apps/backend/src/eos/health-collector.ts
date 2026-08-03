import { engineeringEventBus } from './event-bus.js';

export interface HealthProbe {
  name: string;
  check: () => Promise<'healthy' | 'degraded' | 'down'>;
}

const probes: HealthProbe[] = [];

export function registerHealthProbe(probe: HealthProbe): void {
  probes.push(probe);
}

export async function runHealthProbes(): Promise<void> {
  for (const probe of probes) {
    try {
      const status = await Promise.race([
        probe.check(),
        new Promise<'down'>((resolve) => {
          const t = setTimeout(() => resolve('down'), 5000);
          t.unref?.();
        }),
      ]);

      if (status !== 'healthy') {
        engineeringEventBus.emit({
          type: 'health.check',
          timestamp: Date.now(),
          source: 'health-collector',
          payload: {
            service: probe.name,
            status,
          },
        });
      }
    } catch {
      engineeringEventBus.emit({
        type: 'health.check',
        timestamp: Date.now(),
        source: 'health-collector',
        payload: {
          service: probe.name,
          status: 'down' as const,
          details: { error: 'probe threw or timed out' },
        },
      });
    }
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startHealthCollector(intervalMs = 60_000): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    runHealthProbes().catch(() => {});
  }, intervalMs);
  intervalHandle.unref?.();
}

export function stopHealthCollector(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
