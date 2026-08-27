/**
 * Conway Automaton — Structured Logger
 * JSON-serialized logs with module namespacing and configurable levels.
 */

import type { LogLevel, StructuredLogger } from '../types.js';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

let globalLogLevel: LogLevel = 'info';

export function setGlobalLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[globalLogLevel];
}

function formatLogEntry(level: LogLevel, module: string, message: string, context?: Record<string, unknown>): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
  };
  if (context && Object.keys(context).length > 0) {
    entry.context = context;
  }
  return JSON.stringify(entry);
}

function emit(level: LogLevel, module: string, message: string, context?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const formatted = formatLogEntry(level, module, message, context);

  switch (level) {
    case 'debug':
    case 'info':
      console.log(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    case 'error':
    case 'fatal':
      console.error(formatted);
      break;
  }
}

class StructuredLoggerImpl implements StructuredLogger {
  private module: string;

  constructor(module: string) {
    this.module = module;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    emit('debug', this.module, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    emit('info', this.module, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    emit('warn', this.module, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    emit('error', this.module, message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    emit('fatal', this.module, message, context);
  }

  child(subModule: string): StructuredLogger {
    return new StructuredLoggerImpl(`${this.module}:${subModule}`);
  }
}

export function createLogger(module: string): StructuredLogger {
  return new StructuredLoggerImpl(module);
}
