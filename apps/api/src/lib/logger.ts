/**
 * Minimal structured logger. Keeps a consistent shape without pulling in a
 * logging framework; swap the sink here if we later want JSON/transport output.
 */
type Fields = Record<string, unknown>

function emit(level: 'info' | 'warn' | 'error', message: string, fields?: Fields): void {
  const line = fields && Object.keys(fields).length > 0 ? `${message} ${JSON.stringify(fields)}` : message
  if (level === 'error') console.error(`[${level}] ${line}`)
  else if (level === 'warn') console.warn(`[${level}] ${line}`)
  else console.log(`[${level}] ${line}`)
}

export const logger = {
  info: (message: string, fields?: Fields) => emit('info', message, fields),
  warn: (message: string, fields?: Fields) => emit('warn', message, fields),
  error: (message: string, fields?: Fields) => emit('error', message, fields)
}

export type Logger = typeof logger
