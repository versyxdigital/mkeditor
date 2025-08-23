import type { Dropdown, Modal } from 'bootstrap';
import type { BridgeManager } from '../core/BridgeManager';
import type { CommandProvider } from '../core/providers/CommandProvider';
import type { SettingsProvider } from '../core/providers/SettingsProvider';
import type { CompletionProvider } from '../core/providers/CompletionProvider';

export interface Providers {
  bridge: BridgeManager | null;
  commands: CommandProvider | null;
  completion: CompletionProvider | null;
  settings: SettingsProvider | null;
}

export interface ModalProviders {
  about: Modal;
  settings: Modal;
  shortcuts: Modal;
}

export interface DropdownProviders {
  alertblocks: Dropdown;
  codeblocks: Dropdown;
  tables: Dropdown;
}

export interface BridgeProviders extends Omit<Providers, 'bridge'> {
  [key: string]: unknown | null;
}

export interface EditorProviders extends Providers {
  [key: string]: unknown | null;
}

export type ValidCommand = keyof CommandProvider;
export type ValidDropdown = keyof DropdownProviders;
export type ValidModal = keyof ModalProviders;
