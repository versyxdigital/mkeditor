import type { CloudProviderId } from '../app/interfaces/Cloud';

const providerLabels = new Set([
  'connect',
  'default_unavailable',
  'custom_app',
  'client_id',
  'registration_help',
  'editing_permission',
  'editing_intro_description',
  'callback_body',
  'error_auth',
  'error_network',
  'error_throttled',
  'error_quota',
  'error_conflict',
  'error_configuration',
  'error_unconfirmed',
  'error_not_applied',
  'operation_unconfirmed',
  'read_only_reason',
  'preview_limit',
  'unsupported',
  'save_copy',
  'save_copy_help',
  'compare',
  'reload',
  'reload_confirm',
  'save_saved',
  'document_actions',
  'tab_label',
  'recovered_draft',
  'checking_recovery',
]);
/** Keep provider wording out of connection/document orchestration. */
export function cloudMessageKey(
  key: string,
  provider?: CloudProviderId,
): string {
  return `cloud:${provider === 'dropbox' && providerLabels.has(key) ? 'dropbox.' : ''}${key}`;
}
