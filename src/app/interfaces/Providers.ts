import { AppBridge } from '../lib/AppBridge';
import { AppSettings } from '../lib/AppSettings';

export interface Providers {
  [key: string]: unknown | null;
}

export interface BridgeProviders extends Providers {
  bridge: AppBridge | null;
}

export interface SettingsProviders extends Providers {
  settings: AppSettings | null;
}