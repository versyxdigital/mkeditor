import type { AppBridge } from '../lib/AppBridge';
import type { AppSettings } from '../lib/AppSettings';
import type { AppState } from '../lib/AppState';
import type { LogConfig } from './Logging';

export interface Providers {
  [key: string]: unknown | null;
  logger: LogConfig | null;
  state: AppState | null;
}

export interface BridgeProviders extends Providers {
  bridge: AppBridge | null;
}

export interface SettingsProviders extends Providers {
  settings: AppSettings | null;
}
