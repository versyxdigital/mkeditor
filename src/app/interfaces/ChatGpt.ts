/** Public subscription state. OAuth credentials stay in the main process. */
export interface ChatGptSnapshot {
  mode: 'api-key' | 'chatgpt';
  signingIn: boolean;
  connected: boolean;
  activeId?: string;
  accounts: Array<{ id: string; label: string }>;
  models: Array<{ id: string; label: string }>;
  welcome: boolean;
  error?: ChatGptError;
}

export type ChatGptError =
  | 'sign_in_required'
  | 'sign_in_failed'
  | 'permission_required'
  | 'storage_failed'
  | 'network_error'
  | 'revocation_unconfirmed'
  | 'usage_limit'
  | 'unavailable';

export type ChatGptCommand =
  | { action: 'mode'; mode: 'api-key' | 'chatgpt' }
  | { action: 'sign-in'; accountId?: string; callback?: ChatGptCallbackCopy }
  | { action: 'select'; accountId: string }
  | { action: 'sign-out' }
  | { action: 'cancel' }
  | { action: 'models' }
  | { action: 'welcome' }
  | { action: 'usage' };

/** Translated presentation text supplied by the renderer, never OAuth data. */
export interface ChatGptCallbackCopy {
  language: string;
  successTitle: string;
  successBody: string;
  errorTitle: string;
  errorBody: string;
  permissionTitle: string;
  permissionBody: string;
  returnToApp: string;
}
