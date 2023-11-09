import { AppSettings } from '../lib/AppSettings';

export interface BridgedEditorContent {
  original: string | null;
  current: string | null;
}

export interface BridgeProviders {
  settings: AppSettings | null;
  [key: string]: unknown | null;
}
