import type { MainLogger } from 'electron-log';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export type Logger = Pick<MainLogger, LogLevel>;

export interface LogConfig {
  log: MainLogger;
  logpath: string;
}

export interface LogMessage {
  level: LogLevel;
  msg: unknown;
  meta?: unknown;
}
