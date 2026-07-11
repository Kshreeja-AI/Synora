import type { LogLevel, Logger } from '@synora/core';
import pino, { type Logger as PinoLogger } from 'pino';

class PinoLoggerAdapter implements Logger {
  constructor(private readonly pino: PinoLogger) {}

  child(bindings: Record<string, unknown>): Logger {
    return new PinoLoggerAdapter(this.pino.child(bindings));
  }

  trace(msg: string, fields?: Record<string, unknown>): void {
    this.pino.trace(fields ?? {}, msg);
  }
  debug(msg: string, fields?: Record<string, unknown>): void {
    this.pino.debug(fields ?? {}, msg);
  }
  info(msg: string, fields?: Record<string, unknown>): void {
    this.pino.info(fields ?? {}, msg);
  }
  warn(msg: string, fields?: Record<string, unknown>): void {
    this.pino.warn(fields ?? {}, msg);
  }
  error(msg: string, fields?: Record<string, unknown>): void {
    this.pino.error(fields ?? {}, msg);
  }
  fatal(msg: string, fields?: Record<string, unknown>): void {
    this.pino.fatal(fields ?? {}, msg);
  }
}

export interface CreateLoggerOptions {
  serviceName: string;
  level?: LogLevel;
  pretty?: boolean;
  /** Redact known-sensitive field paths from every log line (defense in depth). */
  redactPaths?: string[];
}

const DEFAULT_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'apiKey',
  'secret',
  '*.password',
  '*.token',
];

export function createLogger(options: CreateLoggerOptions): Logger {
  const instance = pino({
    name: options.serviceName,
    level: options.level ?? 'info',
    redact: {
      paths: [...DEFAULT_REDACT_PATHS, ...(options.redactPaths ?? [])],
      censor: '[REDACTED]',
    },
    transport: options.pretty ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  });
  return new PinoLoggerAdapter(instance);
}
