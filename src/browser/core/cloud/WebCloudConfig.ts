import type { CloudProviderId } from '../../../app/interfaces/Cloud';

/** Public web registrations; desktop registrations and client secrets never belong here. */
export interface WebCloudConfig {
  googleClientId: string;
  dropboxAppKey: string;
}

declare const __MKEDITOR_WEB_CLOUD_CONFIG__: WebCloudConfig;

export const defaultWebCloudConfig: WebCloudConfig =
  typeof __MKEDITOR_WEB_CLOUD_CONFIG__ === 'undefined'
    ? { googleClientId: '', dropboxAppKey: '' }
    : __MKEDITOR_WEB_CLOUD_CONFIG__;

export function webCloudClientId(
  config: WebCloudConfig,
  provider: CloudProviderId,
): string {
  const value =
    provider === 'dropbox' ? config.dropboxAppKey : config.googleClientId;
  const valid =
    provider === 'dropbox'
      ? /^[a-zA-Z0-9_-]{4,100}$/.test(value)
      : /^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value);
  return valid ? value : '';
}
