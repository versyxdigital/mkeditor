import { Bridge } from '../lib/Bridge';
import { Command } from '../lib/Command';
import { Settings } from '../lib/Settings';


export interface BridgeProviders {
  settings: Settings | null;
  command: Command | null;
  [key: string]: unknown | null;
}

export interface EditorProviders {
  bridge: Bridge|null;
  command: Command|null;
  settings: Settings|null;
  [key: string]: unknown | null;
}