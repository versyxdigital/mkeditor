import { CloudError } from './CloudError';
import { beginBrowserAuthorization } from './BrowserAuthorization';
import type { CloudCallbackCopy } from '../../interfaces/Cloud';
import {
  GoogleDriveClient,
  DRIVE_SCOPE,
  DRIVE_FILE_SCOPE,
  DRIVE_WRITE_SCOPE,
  type DriveRegistration,
  type DriveTokens,
} from './GoogleDriveClient';
export {
  DRIVE_SCOPE,
  DRIVE_FILE_SCOPE,
  DRIVE_WRITE_SCOPE,
  type DriveRegistration,
  type DriveTokens,
  type DriveEndpoints,
} from './GoogleDriveClient';

/** Desktop OAuth stays outside the shared REST transport. */
export class GoogleDrive extends GoogleDriveClient {
  async beginAuthorization(
    registration: DriveRegistration,
    openBrowser: (url: string) => Promise<void>,
    timeoutMs = 180_000,
    copy?: CloudCallbackCopy,
    scopes: readonly string[] = [DRIVE_SCOPE],
  ): Promise<{ result: Promise<DriveTokens>; cancel: () => void }> {
    if (
      !scopes.includes(DRIVE_SCOPE) ||
      scopes.some(
        (scope) =>
          scope !== DRIVE_SCOPE &&
          scope !== DRIVE_FILE_SCOPE &&
          scope !== DRIVE_WRITE_SCOPE,
      )
    )
      throw new CloudError('configuration');
    return beginBrowserAuthorization({
      authorizeUrl: this.endpoints.authorize,
      parameters: {
        client_id: registration.clientId,
        scope: scopes.join(' '),
        access_type: 'offline',
        prompt: 'consent',
      },
      exchange: (form) => this.token(registration, form),
      openBrowser,
      timeoutMs,
      copy,
    });
  }
}
