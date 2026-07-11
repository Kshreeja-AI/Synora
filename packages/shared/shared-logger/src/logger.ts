import pino, { type Logger as PinoLogger } from 'pino';
import { getCorrelationId } from './correlation.js';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface LoggerOptions {
  level: LogLevel;
  name?: string;
  /** Pretty-print for local development. Defaults to false (structured JSON, suitable for prod). */
  pretty?: boolean;
}

const REDACT_PATHS = ['*.password', '*.token', '*.apiKey', '*.secret', '*.authorization'];

export interface Logger {
  fatal(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  trace(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

class PinoLoggerAdapter implements Logger {
  constructor(private readonly pino: PinoLogger) {}

  private log(level: keyof PinoLogger, message: string, meta?: Record<string, unknown>): void {
    const correlationId = getCorrelationId();
    (this.pino[level] as (obj: Record<string, unknown>, msg: string) => void)(
      { ...meta, ...(correlationId ? { correlationId } : {}) },
      message,
    );
  }

  fatal(message: string, meta?: Record<string, unknown>): void {
    this.log('fatal', message, meta);
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }
  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }
  trace(message: string, meta?: Record<string, unknown>): void {
    this.log('trace', message, meta);
  }

  child(bindings: Record<string, unknown>): Logger {
    return new PinoLoggerAdapter(this.pino.child(bindings));
  }
}

export function createLogger(options: LoggerOptions): Logger {
  const instance = pino({
    name: options.name ?? 'synora',
    level: options.level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...(options.pretty ? { transport: { target: 'pino-pretty' } } : {}),
  });
  return new PinoLoggerAdapter(instance);
}
