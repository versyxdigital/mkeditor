import type { CloudProviderId } from '../../../app/interfaces/Cloud';
import type { CloudRegistration } from '../../../app/lib/cloud/CloudProvider';
import { GoogleDriveClient } from '../../../app/lib/cloud/GoogleDriveClient';
import { DropboxClient } from '../../../app/lib/cloud/DropboxClient';
import { CloudError } from '../../../app/lib/cloud/CloudError';
import type { WebCloudAuth } from './WebCloudAuth';

export type WebCloudAuthorization = Pick<
  WebCloudAuth,
  | 'beginAuthorization'
  | 'reserveAuthorization'
  | 'configured'
  | 'registration'
  | 'prepare'
  | 'dispose'
>;

function authorize(
  auth: WebCloudAuthorization,
  provider: CloudProviderId,
  registration: CloudRegistration,
  scopes: readonly string[],
) {
  if (
    !auth.configured(provider) ||
    registration.clientValue !== '' ||
    registration.clientId !== auth.registration(provider).clientId
  )
    throw new CloudError('configuration');
  return auth.beginAuthorization(provider, scopes);
}

/** Only browser-supported authorization is substituted; conditional REST paths are shared. */
export class WebGoogleDrive extends GoogleDriveClient {
  constructor(private readonly auth: WebCloudAuthorization) {
    super();
  }

  override async beginAuthorization(
    registration: CloudRegistration,
    _openBrowser: (url: string) => Promise<void>,
    _timeout?: number,
    _copy?: import('../../../app/interfaces/Cloud').CloudCallbackCopy,
    scopes = this.authorizationScopes(false),
  ) {
    return authorize(this.auth, this.provider, registration, scopes);
  }

  override async refresh(): Promise<never> {
    throw new CloudError('auth');
  }
}

export class WebDropbox extends DropboxClient {
  constructor(private readonly auth: WebCloudAuthorization) {
    super();
  }

  override async beginAuthorization(
    registration: CloudRegistration,
    _openBrowser: (url: string) => Promise<void>,
    _timeout?: number,
    _copy?: import('../../../app/interfaces/Cloud').CloudCallbackCopy,
    scopes = this.authorizationScopes(false),
  ) {
    return authorize(this.auth, this.provider, registration, scopes);
  }

  override async refresh(): Promise<never> {
    throw new CloudError('auth');
  }
}
