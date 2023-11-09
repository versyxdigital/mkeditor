import { Command } from '../lib/Command';
import { Settings } from '../lib/Settings';

export interface ContextBridgeAPI {
  send: (channel: string, data: any) => void;
  receive: (channel: string, fn: (...args: any[]) => void) => void;
}

export interface ContextBridgedFile {
  file: string;
  filename: string;
  content: string;
}

export interface BridgeProviders {
  settings: Settings | null;
  command: Command | null;
  [key: string]: unknown | null;
}