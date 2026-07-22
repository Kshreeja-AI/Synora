import winston from 'winston';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
};

winston.addColors(colors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...args } = info;
    const ts = String(timestamp).slice(0, 19).replace('T', ' ');
    return `${ts} [${level}]: ${message} ${Object.keys(args).length ? JSON.stringify(args, null, 2) : ''}`;
  })
);

// File transports write to a relative `logs/` directory — convenient for
// local development, but wrong for a container: the runtime filesystem is
// ephemeral, there's no guarantee `logs/` is writable by the non-root user
// the production image runs as (it isn't, by default), and any orchestrator
// worth using already captures stdout/stderr. So they're dev-only; every
// other stage relies on Console, exactly as `docker logs`/the platform's
// log aggregator expects.
const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      format
    ),
  }),
  ...(process.env.NODE_ENV === 'production'
    ? []
    : [
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          format,
        }),
        new winston.transports.File({
          filename: 'logs/all.log',
          format,
        }),
      ]),
];

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format,
  transports,
});
