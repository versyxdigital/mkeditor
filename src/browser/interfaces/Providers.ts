import type { BridgeManager } from '../core/BridgeManager';
import type { CommandProvider } from '../core/providers/CommandProvider';
import type { SettingsProvider } from '../core/providers/SettingsProvider';
import type { CompletionProvider } from '../core/providers/CompletionProvider';
import type { ExportSettingsProvider } from '../core/providers/ExportSettingsProvider';

export interface Providers {
  bridge: BridgeManager | null;
  commands: CommandProvider | null;
  completion: CompletionProvider | null;
  settings: SettingsProvider | null;
  exportSettings: ExportSettingsProvider | null;
}

export interface BridgeProviders extends Omit<Providers, 'bridge'> {
  [key: string]: unknown | null;
}

export interface EditorProviders extends Providers {
  [key: string]: unknown | null;
}

export type ValidCommand = keyof CommandProvider;
