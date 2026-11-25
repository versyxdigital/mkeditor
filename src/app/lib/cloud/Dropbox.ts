import { CloudError } from './CloudError';
import { createHash } from 'crypto';
import { beginBrowserAuthorization } from './BrowserAuthorization';
import type { CloudCallbackCopy } from '../../interfaces/Cloud';
import type { CloudRegistration, CloudTokens } from './CloudProvider';
import {
  DROPBOX_CALLBACK_PORT,
  dropboxRegistrationSchema,
} from './DropboxRegistration';
import {
  DropboxClient,
  DROPBOX_READ_SCOPES,
  DROPBOX_WRITE_SCOPES,
  type DropboxEndpoints,
} from './DropboxClient';
export {
  DROPBOX_READ_SCOPES,
  DROPBOX_WRITE_SCOPES,
  type DropboxEndpoints,
} from './DropboxClient';
const limit = 4 * 1024 * 1024;
/** Dropbox hashes the concatenated SHA-256 hashes of its 4 MiB blocks. */
export function dropboxContentHash(content: Uint8Array): string {
  const hashes: Buffer[] = [];
  for (let offset = 0; offset < content.length; offset += limit)
    hashes.push(
      createHash('sha256')
        .update(content.subarray(offset, offset + limit))
        .digest(),
    );
  return createHash('sha256').update(Buffer.concat(hashes)).digest('hex');
}

/** Desktop OAuth stays outside the shared REST transport. */
export class Dropbox extends DropboxClient {
  constructor(
    endpoints?: DropboxEndpoints,
    private readonly callbackPort = DROPBOX_CALLBACK_PORT,
  ) {
    super(endpoints);
  }

  async beginAuthorization(
    registration: CloudRegistration,
    openBrowser: (url: string) => Promise<void>,
    timeoutMs = 180_000,
    copy?: CloudCallbackCopy,
    scopes: readonly string[] = DROPBOX_READ_SCOPES,
  ) {
    if (
      !dropboxRegistrationSchema.safeParse(registration).success ||
      scopes.some(
        (scope) =>
          ![...DROPBOX_READ_SCOPES, ...DROPBOX_WRITE_SCOPES].includes(scope),
      ) ||
      !DROPBOX_READ_SCOPES.every((scope) => scopes.includes(scope))
    )
      throw new CloudError('configuration');
    return beginBrowserAuthorization({
      authorizeUrl: this.endpoints.authorize,
      parameters: {
        client_id: registration.clientId,
        scope: scopes.join(' '),
        token_access_type: 'offline',
      },
      exchange: (form) => this.token(registration, form, '', scopes),
      openBrowser,
      timeoutMs,
      copy,
      port: this.callbackPort,
    });
  }
}
