import type { AppBridge } from '../lib/AppBridge';
import type { AppMenu } from '../lib/AppMenu';
import type { AppSettings } from '../lib/AppSettings';
import type { AppState } from '../lib/AppState';
import type { LogConfig } from './Logging';

export interface MainProviders {
  [key: string]: unknown | null;
  bridge: AppBridge | null;
  logger: LogConfig | null;
  menu: AppMenu | null;
  state: AppState | null;
  settings: AppSettings | null;
}