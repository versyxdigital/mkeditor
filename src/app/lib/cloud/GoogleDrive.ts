import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { createServer } from 'http';
import { z } from 'zod';
import type {
  CloudCallbackCopy,
  DriveItem,
  DrivePage,
} from '../../interfaces/Cloud';
import { WORKSPACE_EXTENSION_GROUPS } from '../../shared/fileExtensions';
import { CloudError } from './CloudError';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_WRITE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const fields =
  'id,name,mimeType,modifiedTime,version,parents,driveId,trashed,shortcutDetails(targetId,targetMimeType,targetResourceKey),resourceKey,size,headRevisionId,md5Checksum,appProperties,capabilities(canEdit,canModifyContent,canAddChildren)';
const metadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  trashed: z.boolean().optional(),
  modifiedTime: z.string().optional(),
  version: z.string().optional(),
  parents: z.array(z.string()).optional(),
  driveId: z.string().optional(),
  size: z.string().optional(),
  resourceKey: z.string().optional(),
  headRevisionId: z.string().optional(),
  md5Checksum: z.string().optional(),
  appProperties: z.record(z.string(), z.string()).optional(),
  capabilities: z
    .object({
      canEdit: z.boolean().optional(),
      canModifyContent: z.boolean().optional(),
      canAddChildren: z.boolean().optional(),
    })
    .optional(),
  shortcutDetails: z
    .object({
      targetId: z.string(),
      targetMimeType: z.string(),
      targetResourceKey: z.string().optional(),
    })
    .optional(),
});
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
export interface DriveTokens {
  access: string;
  refresh: string;
  expires: number;
  scopes?: string[];
}
export interface DriveRegistration {
  clientId: string;
  clientValue: string;
}
const markdownExtensions = WORKSPACE_EXTENSION_GROUPS.find(
  (group) => group.key === 'markdown',
)!.extensions;
function item(meta: z.infer<typeof metadataSchema>): DriveItem {
  const mime = meta.shortcutDetails?.targetMimeType ?? meta.mimeType;
  return {
    id: meta.shortcutDetails?.targetId ?? meta.id,
    name: meta.name,
    kind:
      mime === FOLDER
        ? 'folder'
        : !mime.startsWith('application/vnd.google-apps.') &&
            markdownExtensions.some((ext) =>
              meta.name.toLowerCase().endsWith(`.${ext}`),
            )
          ? 'markdown'
          : 'unsupported',
    modifiedTime: meta.modifiedTime,
    revision: meta.version,
    parents: meta.parents ?? [],
    driveId: meta.driveId,
  };
}

/** Fixed production endpoints; only unit fixtures inject alternative endpoints. */
export interface DriveEndpoints {
  authorize: string;
  token: string;
  api: string;
}
const production: DriveEndpoints = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  api: 'https://www.googleapis.com/drive/v3/',
};

export class GoogleDrive {
  constructor(private readonly endpoints: DriveEndpoints = production) {}

  async request(
    url: string,
    init: RequestInit = {},
    safeRead = true,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        if (safeRead && attempt < 2) {
          await this.pause(250 * 2 ** attempt);
          continue;
        }
        throw new CloudError('network');
      }
      if (response.ok) return response;
      const body: unknown = await response.json().catch(() => null);
      const parsed = z
        .object({
          error: z.union([
            z.string(),
            z.object({
              errors: z.array(z.object({ reason: z.string() })).optional(),
            }),
          ]),
        })
        .safeParse(body);
      const reason = parsed.success
        ? typeof parsed.data.error === 'string'
          ? parsed.data.error
          : parsed.data.error.errors?.[0]?.reason
        : undefined;
      const limited =
        response.status === 429 ||
        reason === 'rateLimitExceeded' ||
        reason === 'userRateLimitExceeded';
      if (safeRead && attempt < 2 && (limited || response.status >= 500)) {
        const hint = response.headers.get('retry-after');
        const wait =
          hint && /^\d+$/.test(hint)
            ? Number(hint) * 1000
            : hint
              ? Date.parse(hint) - Date.now()
              : 250 * 2 ** attempt;
        // Do not retry early if the provider asks for a longer delay.
        if (wait <= 5000 && Number.isFinite(wait)) {
          await this.pause(Math.max(0, wait));
          continue;
        }
      }
      throw new CloudError(
        response.status === 401 || reason === 'invalid_grant'
          ? 'auth'
          : reason === 'invalid_client' ||
              reason === 'redirect_uri_mismatch' ||
              reason === 'invalid_scope'
            ? 'configuration'
            : limited
              ? 'throttled'
              : reason === 'storageQuotaExceeded' ||
                  reason === 'dailyLimitExceeded' ||
                  reason === 'quotaExceeded'
                ? 'quota'
                : response.status === 403
                  ? 'permission'
                  : response.status === 404 || response.status === 410
                    ? 'missing'
                    : response.status === 409 || response.status === 412
                      ? 'conflict'
                      : response.status >= 500
                        ? 'network'
                        : 'configuration',
      );
    }
  }

  private pause(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async token(
    registration: DriveRegistration,
    form: Record<string, string>,
    previousRefresh = '',
    previousScopes: string[] = [DRIVE_SCOPE],
  ): Promise<DriveTokens> {
    const response = await this.request(
      this.endpoints.token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: registration.clientId,
          client_secret: registration.clientValue,
          ...form,
        }),
      },
      false,
    );
    const parsed = tokenSchema.safeParse(await response.json());
    if (!parsed.success) throw new CloudError('configuration');
    const result = parsed.data;
    const scopes = result.scope?.split(' ') ?? previousScopes;
    if (!scopes.includes(DRIVE_SCOPE) && !scopes.includes(DRIVE_WRITE_SCOPE))
      throw new CloudError('permission');
    const refresh = result.refresh_token ?? previousRefresh;
    if (!refresh) throw new CloudError('auth');
    return {
      access: result.access_token,
      refresh,
      expires: Date.now() + result.expires_in * 1000,
      scopes,
    };
  }

  refresh(registration: DriveRegistration, refresh: string, scopes?: string[]) {
    return this.token(
      registration,
      { grant_type: 'refresh_token', refresh_token: refresh },
      refresh,
      scopes,
    );
  }

  private async get(
    access: string,
    path: string,
    params: Record<string, string>,
    resourceKey?: string,
  ): Promise<Response> {
    const url = new URL(path, this.endpoints.api);
    url.search = new URLSearchParams(params).toString();
    return this.request(url.toString(), {
      headers: {
        Authorization: `Bearer ${access}`,
        ...(resourceKey ? { 'X-Goog-Drive-Resource-Keys': resourceKey } : {}),
      },
    });
  }

  async account(access: string): Promise<{ id: string; name: string }> {
    const response = await this.get(access, 'about', {
      fields: 'user(permissionId,emailAddress,displayName)',
    });
    const result = z
      .object({
        user: z.object({
          permissionId: z.string().min(1),
          emailAddress: z.string().optional(),
          displayName: z.string().optional(),
        }),
      })
      .safeParse(await response.json());
    if (!result.success) throw new CloudError('auth');
    return {
      id: result.data.user.permissionId,
      name:
        result.data.user.emailAddress ??
        result.data.user.displayName ??
        result.data.user.permissionId,
    };
  }

  private readonly resourceKeys = new Map<string, string>();
  private remember(meta: z.infer<typeof metadataSchema>) {
    if (meta.resourceKey)
      this.resourceKeys.set(meta.id, `${meta.id}/${meta.resourceKey}`);
    const shortcut = meta.shortcutDetails;
    if (shortcut?.targetResourceKey)
      this.resourceKeys.set(
        shortcut.targetId,
        `${shortcut.targetId}/${shortcut.targetResourceKey}`,
      );
  }

  async list(
    access: string,
    folderId: string,
    driveId?: string,
    page?: string,
  ): Promise<DrivePage> {
    const escaped = folderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const response = await this.get(
      access,
      'files',
      {
        q: `'${escaped}' in parents and trashed = false`,
        pageSize: '100',
        fields: `nextPageToken,files(${fields})`,
        orderBy: 'folder,name,modifiedTime desc',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        corpora: driveId ? 'drive' : 'user',
        ...(driveId ? { driveId } : {}),
        ...(page ? { pageToken: page } : {}),
      },
      this.resourceKeys.get(folderId),
    );
    const parsed = z
      .object({
        nextPageToken: z.string().optional(),
        files: z.array(metadataSchema),
      })
      .safeParse(await response.json());
    if (!parsed.success) throw new CloudError('network');
    parsed.data.files.forEach((meta) => this.remember(meta));
    return {
      items: parsed.data.files.filter((meta) => !meta.trashed).map(item),
      nextPage: parsed.data.nextPageToken,
    };
  }

  async drives(access: string, page?: string): Promise<DrivePage> {
    const response = await this.get(access, 'drives', {
      pageSize: '100',
      fields: 'nextPageToken,drives(id,name)',
      ...(page ? { pageToken: page } : {}),
    });
    const parsed = z
      .object({
        nextPageToken: z.string().optional(),
        drives: z.array(z.object({ id: z.string(), name: z.string() })),
      })
      .safeParse(await response.json());
    if (!parsed.success) throw new CloudError('network');
    return {
      items: parsed.data.drives.map((drive) => ({
        ...drive,
        kind: 'folder',
        parents: [],
        driveId: drive.id,
      })),
      nextPage: parsed.data.nextPageToken,
    };
  }

  async metadata(access: string, id: string) {
    const response = await this.get(
      access,
      `files/${encodeURIComponent(id)}`,
      { fields, supportsAllDrives: 'true' },
      this.resourceKeys.get(id),
    );
    const parsed = metadataSchema.safeParse(await response.json());
    if (!parsed.success) throw new CloudError('network');
    if (parsed.data.trashed) throw new CloudError('missing');
    this.remember(parsed.data);
    return parsed.data;
  }

  async read(
    access: string,
    id: string,
    editing = false,
  ): Promise<{ item: DriveItem; content: string }> {
    let meta = await this.metadata(access, id);
    if (meta.shortcutDetails)
      meta = await this.metadata(access, meta.shortcutDetails.targetId);
    const entry = item(meta);
    if (entry.kind !== 'markdown') throw new CloudError('unsupported');
    // Keep the revision coupled to the contents, rather than a stale listing.
    if (!meta.version) throw new CloudError('unsupported');
    let beforeValidator:
      Awaited<ReturnType<GoogleDrive['contentValidator']>> | undefined;
    if (
      editing &&
      !meta.driveId &&
      meta.capabilities?.canEdit &&
      meta.headRevisionId &&
      meta.md5Checksum
    ) {
      try {
        beforeValidator = await this.contentValidator(access, meta.id);
      } catch (error) {
        if (!(error instanceof CloudError) || error.code !== 'unsupported')
          throw error;
      }
    }
    if (Number(meta.size ?? 0) > 4 * 1024 * 1024)
      throw new CloudError('unsupported');
    const response = await this.get(
      access,
      `files/${encodeURIComponent(meta.id)}`,
      { alt: 'media', supportsAllDrives: 'true' },
      this.resourceKeys.get(meta.id),
    );
    const reader = response.body?.getReader();
    if (!reader) throw new CloudError('network');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new CloudError('unsupported');
      }
      chunks.push(next.value);
    }
    const current = await this.metadata(access, meta.id);
    if (
      meta.headRevisionId && current.headRevisionId
        ? meta.headRevisionId !== current.headRevisionId ||
          meta.md5Checksum !== current.md5Checksum
        : current.version !== meta.version
    )
      throw new CloudError('conflict');
    const afterValidator = beforeValidator
      ? await this.contentValidator(access, meta.id)
      : undefined;
    if (beforeValidator && afterValidator?.etag !== beforeValidator.etag)
      throw new CloudError('conflict');
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks),
      );
    } catch {
      throw new CloudError('unsupported');
    }
    const entryItem = item(current);
    entryItem.contentRevision = current.headRevisionId;
    entryItem.validator = afterValidator?.etag;
    entryItem.editable =
      editing &&
      !current.driveId &&
      current.capabilities?.canEdit === true &&
      current.capabilities.canModifyContent !== false &&
      Boolean(
        entryItem.validator && current.headRevisionId && current.md5Checksum,
      );
    if (!entryItem.editable)
      entryItem.readOnlyReason = current.driveId
        ? 'shared-drive'
        : !entryItem.validator && editing
          ? 'validator'
          : 'permission';
    return { item: entryItem, content };
  }

  async contentValidator(access: string, id: string) {
    const response = await this.get(
      access,
      `../v2/files/${encodeURIComponent(id)}`,
      {
        supportsAllDrives: 'true',
        updateViewedDate: 'false',
        fields: 'id,etag,version,headRevisionId',
      },
    );
    const result = z
      .object({
        id: z.string(),
        etag: z.string(),
        version: z.string().optional(),
        headRevisionId: z.string().optional(),
      })
      .safeParse(await response.json());
    if (
      !result.success ||
      result.data.id !== id ||
      !/^"[^"\r\n]+"$/.test(result.data.etag)
    )
      throw new CloudError('unsupported');
    return result.data;
  }

  /** Exactly the v2 multipart/If-Match path verified by the live spike. */
  async update(
    access: string,
    id: string,
    validator: string,
    content: string,
    authorize: () => void,
  ) {
    const meta = await this.metadata(access, id);
    if (item(meta).kind !== 'markdown' || meta.driveId)
      throw new CloudError('unsupported');
    if (
      meta.capabilities?.canEdit !== true ||
      meta.capabilities.canModifyContent === false
    )
      throw new CloudError('permission');
    if (Buffer.byteLength(content) > 4 * 1024 * 1024)
      throw new CloudError('unsupported');
    const boundary = `mkeditor_${randomBytes(18).toString('hex')}`;
    const body = `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n{}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=utf-8\r\n\r\n${content}\r\n--${boundary}--\r\n`;
    authorize();
    let response: Response;
    try {
      response = await this.request(
        new URL(
          `/upload/drive/v2/files/${encodeURIComponent(id)}?uploadType=multipart&supportsAllDrives=true`,
          this.endpoints.api,
        ).toString(),
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${access}`,
            'If-Match': validator,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
        },
        false,
      );
    } catch (error) {
      if (error instanceof CloudError && error.code !== 'network') throw error;
      throw new CloudError('unconfirmed');
    }
    try {
      const ack = z
        .object({
          id: z.string(),
          etag: z.string(),
          version: z.string().optional(),
          headRevisionId: z.string().optional(),
          modifiedDate: z.string().optional(),
        })
        .parse(await response.json());
      if (ack.id !== id || !/^"[^"\r\n]+"$/.test(ack.etag))
        throw new Error('Invalid write acknowledgement');
      return {
        item: {
          ...item(meta),
          revision: ack.version,
          contentRevision: ack.headRevisionId,
          validator: ack.etag,
          modifiedTime: ack.modifiedDate ?? meta.modifiedTime,
          editable: true,
        },
        content,
      };
    } catch {
      throw new CloudError('unconfirmed');
    }
  }

  async prepareCreate(access: string, folderId: string, name: string) {
    const folder = await this.metadata(access, folderId);
    if (folder.mimeType !== FOLDER || folder.driveId)
      throw new CloudError('unsupported');
    if (folder.capabilities?.canAddChildren !== true)
      throw new CloudError('permission');
    const escape = (value: string) =>
      value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const existing = await this.get(access, 'files', {
      q: `'${escape(folderId)}' in parents and name = '${escape(name)}' and trashed = false`,
      fields: 'files(id)',
      pageSize: '1',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    const duplicates = z
      .object({ files: z.array(z.object({ id: z.string() })) })
      .parse(await existing.json());
    if (duplicates.files.length) throw new CloudError('duplicate');
    const response = await this.get(access, 'files/generateIds', {
      count: '1',
      space: 'drive',
      type: 'files',
    });
    return z
      .object({ ids: z.array(z.string()).length(1) })
      .parse(await response.json()).ids[0];
  }

  async create(
    access: string,
    id: string,
    folderId: string,
    name: string,
    content: string,
    operationId: string,
    authorize: () => void,
  ) {
    if (Buffer.byteLength(content) > 4 * 1024 * 1024)
      throw new CloudError('unsupported');
    const boundary = `mkeditor_${randomBytes(18).toString('hex')}`;
    const body = `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ id, name, parents: [folderId], mimeType: 'text/markdown', appProperties: { mkeditorCreateOperation: operationId } })}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=utf-8\r\n\r\n${content}\r\n--${boundary}--\r\n`;
    authorize();
    try {
      const response = await this.request(
        new URL(
          '/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
          this.endpoints.api,
        ).toString(),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${access}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
        },
        false,
      );
      const ack = z.object({ id: z.string() }).parse(await response.json());
      if (ack.id !== id) throw new CloudError('unconfirmed');
    } catch (error) {
      if (error instanceof CloudError && error.code !== 'network') throw error;
      throw new CloudError('unconfirmed');
    }
  }

  async beginAuthorization(
    registration: DriveRegistration,
    openBrowser: (url: string) => Promise<void>,
    timeoutMs = 180_000,
    copy: CloudCallbackCopy = defaultCopy,
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
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    let settled = false;
    let rejectFlow!: (reason: CloudError) => void;
    let resolveFlow!: (value: DriveTokens) => void;
    const result = new Promise<DriveTokens>((resolve, reject) => {
      resolveFlow = resolve;
      rejectFlow = reject;
    });
    // Callers attach immediately after this method returns; browser launch can fail earlier.
    void result.catch(() => {});
    const cancel = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server?.close();
      server?.closeAllConnections();
      rejectFlow(new CloudError('cancelled'));
    };
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const values = url.searchParams;
      const provided = values.get('state') ?? '';
      const valid =
        request.method === 'GET' &&
        url.pathname === '/oauth/callback' &&
        values.getAll('state').length === 1 &&
        Buffer.byteLength(provided) === Buffer.byteLength(state) &&
        timingSafeEqual(Buffer.from(provided), Buffer.from(state)) &&
        ((values.getAll('code').length === 1 &&
          Boolean(values.get('code')) &&
          values.get('code')!.length <= 4096 &&
          !values.has('error')) ||
          (values.getAll('error').length === 1 &&
            Boolean(values.get('error')) &&
            !values.has('code')));
      if (settled || !valid) {
        response.writeHead(400, {
          'Content-Type': 'text/plain; charset=utf-8',
          Connection: 'close',
          'Cache-Control': 'no-store',
        });
        response.end(copy.invalid);
        return;
      }
      settled = true;
      clearTimeout(timer);
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        Connection: 'close',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      });
      response.end(callbackPage(!values.has('error'), copy));
      server.close();
      if (values.has('error')) {
        rejectFlow(new CloudError('cancelled'));
        return;
      }
      void this.token(registration, {
        grant_type: 'authorization_code',
        code: values.get('code')!,
        redirect_uri: redirect,
        code_verifier: verifier,
      }).then(resolveFlow, rejectFlow);
    });
    const timer = setTimeout(cancel, timeoutMs);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
      });
    } catch {
      cancel();
      throw new CloudError('network');
    }
    const address = server.address();
    if (!address || typeof address === 'string') {
      cancel();
      throw new CloudError('network');
    }
    const redirect = `http://127.0.0.1:${address.port}/oauth/callback`;
    const url = new URL(this.endpoints.authorize);
    url.search = new URLSearchParams({
      client_id: registration.clientId,
      redirect_uri: redirect,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    }).toString();
    try {
      await openBrowser(url.toString());
    } catch {
      cancel();
      throw new CloudError('network');
    }
    return { result, cancel };
  }
}

const defaultCopy: CloudCallbackCopy = {
  title: 'Return to MKEditor',
  accepted:
    'Your browser has returned the sign-in response. MKEditor will confirm when your Google Drive connection is ready.',
  cancelled: 'Sign-in cancelled.',
  close: 'You can close this tab.',
  invalid:
    'Invalid or expired sign-in request. Return to MKEditor and try again.',
};
function callbackPage(accepted: boolean, copy: CloudCallbackCopy): string {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character]!,
    );
  return `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MKEditor — Google Drive</title><style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:light-dark(#f5f6f8,#181a1d);color:light-dark(#262a30,#e6e8eb);font:16px system-ui}main{max-width:28rem;padding:2rem}h1{font-size:1.5rem}p{line-height:1.6;opacity:.8}strong{color:light-dark(#28766a,#83bdb1)}</style><main><strong>MKEditor</strong><h1>${escape(copy.title)}</h1><p>${escape(accepted ? copy.accepted : copy.cancelled)}</p><p>${escape(copy.close)}</p></main><script>history.replaceState(null,'','/oauth/callback')</script></html>`;
}
