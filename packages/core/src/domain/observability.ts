export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  trace(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  fatal(msg: string, fields?: Record<string, unknown>): void;
}

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(error: Error): void;
  end(status?: 'ok' | 'error'): void;
}

export interface Tracer {
  startSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T>;
}

export interface MetricsRecorder {
  incrementCounter(name: string, value?: number, tags?: Record<string, string>): void;
  recordHistogram(name: string, value: number, tags?: Record<string, string>): void;
  setGauge(name: string, value: number, tags?: Record<string, string>): void;
}
