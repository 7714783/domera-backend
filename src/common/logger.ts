// Lightweight structured JSON logger — zero deps. Emits one JSON object per
// line to stdout so logs can be shipped to Loki/Elasticsearch as-is.
// Use in place of console.log for production-grade tracing.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = (process.env.LOG_LEVEL || 'info') as LogLevel;

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    service: 'domera-api',
    env: process.env.NODE_ENV || 'development',
    ...fields,
  };
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
  child: (fields: Record<string, unknown>) => ({
    debug: (msg: string, f?: Record<string, unknown>) => emit('debug', msg, { ...fields, ...f }),
    info: (msg: string, f?: Record<string, unknown>) => emit('info', msg, { ...fields, ...f }),
    warn: (msg: string, f?: Record<string, unknown>) => emit('warn', msg, { ...fields, ...f }),
    error: (msg: string, f?: Record<string, unknown>) => emit('error', msg, { ...fields, ...f }),
  }),
};
