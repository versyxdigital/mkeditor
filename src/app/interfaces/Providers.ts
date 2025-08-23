import type { MainLogger } from 'electron-log';
import type { AppBridge } from '../lib/AppBridge';
import type { AppSettings } from '../lib/AppSettings';

export interface Logger {
  log: MainLogger;
  logpath: string;
}

export interface Providers {
  [key: string]: unknown | null;
  logger: Logger | null;
}

export interface BridgeProviders extends Providers {
  bridge: AppBridge | null;
}

export interface SettingsProviders extends Providers {
  settings: AppSettings | null;
}
