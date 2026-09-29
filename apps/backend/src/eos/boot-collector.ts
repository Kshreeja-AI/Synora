import { engineeringEventBus } from './event-bus.js';

export interface BootEvent {
  type: 'server.boot';
  timestamp: number;
  source: 'boot-collector';
  payload: {
    durationMs: number;
    nodeVersion: string;
    pid: number;
    memoryMb: number;
  };
}

let bootStart: number | null = null;

export function markBootStart(): void {
  bootStart = Date.now();
}

export function emitBootComplete(): void {
  const durationMs = bootStart ? Date.now() - bootStart : 0;
  const mem = process.memoryUsage();

  engineeringEventBus.emit({
    type: 'server.boot',
    timestamp: Date.now(),
    source: 'boot-collector',
    payload: {
      durationMs,
      nodeVersion: process.version,
      pid: process.pid,
      memoryMb: Math.round(mem.rss / 1024 / 1024),
    },
  });

  bootStart = null;
}
