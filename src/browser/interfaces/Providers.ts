import { Modal } from 'bootstrap';
import { Bridge } from '../lib/Bridge';
import { Commands } from '../lib/Commands';
import { Settings } from '../lib/Settings';

export interface Providers {
  bridge: Bridge | null;
  commands: Commands | null;
  settings: Settings | null;
}

export interface ModalProviders {
  about: Modal;
  settings: Modal;
  shortcuts: Modal;
}

export interface BridgeProviders extends Omit<Providers, 'bridge'> {
  [key: string]: unknown | null;
}

export interface EditorProviders extends Providers {
  [key: string]: unknown | null;
}

export type ValidModal = keyof ModalProviders;