import { Bridge } from '../lib/Bridge';
import { Command } from '../lib/Command';
import { Settings } from '../lib/Settings';

export interface Providers {
  bridge: Bridge | null;
  command: Command | null;
  settings: Settings | null;
}

export interface BridgeProviders extends Omit<Providers, 'bridge'> {
  [key: string]: unknown | null;
}

export interface EditorProviders extends Providers {
  [key: string]: unknown | null;
}