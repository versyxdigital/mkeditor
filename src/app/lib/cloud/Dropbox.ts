import { createHash } from 'crypto';
import { z } from 'zod';
import type {
  CloudCallbackCopy,
  RemoteItem,
  RemotePage,
} from '../../interfaces/Cloud';
import { WORKSPACE_EXTENSION_GROUPS } from '../../shared/fileExtensions';
import { beginBrowserAuthorization } from './BrowserAuthorization';
import type {
  CloudProvider,
  CloudOrganization,
  CloudRegistration,
  CloudTokens,
  RemoteContents,
} from './CloudProvider';
import { CloudError } from './CloudError';
import {
  DROPBOX_CALLBACK_PORT,
  dropboxRegistrationSchema,
} from './DropboxRegistration';

export const DROPBOX_READ_SCOPES = [
  'account_info.read',
  'files.metadata.read',
  'files.content.read',
];
export const DROPBOX_WRITE_SCOPES = [
  'files.content.write',
  'files.metadata.write',
];
const limit = 4 * 1024 * 1024;
const pendingPrefix = 'pending:';
const markerName = 'MKEditor file creation';
const fieldName = 'operationId';
const groupSchema = z.object({
  template_id: z.string(),
  fields: z.array(z.object({ name: z.string(), value: z.string() })),
});
const metadataSchema = z.object({
  // Upload/download return FileMetadata directly, without the Metadata union tag.
  '.tag': z.enum(['file', 'folder', 'deleted']).default('file'),
  id: z.string().min(1),
  name: z.string().min(1),
  path_lower: z.string().optional(),
  path_display: z.string().optional(),
  rev: z
    .string()
    .regex(/^[0-9a-f]{9,}$/)
    .optional(),
  size: z.number().nonnegative().optional(),
  server_modified: z.string().optional(),
  content_hash: z.string().optional(),
  is_downloadable: z.boolean().optional(),
  sharing_info: z.object({ read_only: z.boolean().optional() }).optional(),
  property_groups: z.array(groupSchema).optional(),
});
type Metadata = z.infer<typeof metadataSchema>;
const preparedSchema = z.object({
  kind: z.enum(['file', 'folder']).default('file'),
  path: z.string().min(1).max(1024),
  folderId: z.string().min(1).max(1024),
  templateId: z.string().min(1),
  operationId: z.string().min(1).max(1024),
});
const markdown = WORKSPACE_EXTENSION_GROUPS.find(
  (group) => group.key === 'markdown',
)!.extensions;
const root = {
  '.tag': 'folder' as const,
  id: 'root',
  name: 'Dropbox',
  path_lower: '',
};
export interface DropboxEndpoints {
  authorize: string;
  token: string;
  api: string;
  content: string;
}
const production: DropboxEndpoints = {
  authorize: 'https://www.dropbox.com/oauth2/authorize',
  token: 'https://api.dropboxapi.com/oauth2/token',
  api: 'https://api.dropboxapi.com/2/',
  content: 'https://content.dropboxapi.com/2/',
};
const parseMetadata = (input: unknown): Metadata => {
  const result = metadataSchema.safeParse(input);
  if (!result.success) throw new CloudError('network');
  if (result.data['.tag'] === 'deleted') throw new CloudError('missing');
  return result.data;
};

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

function prepared(id: string) {
  if (!id.startsWith(pendingPrefix)) return undefined;
  try {
    return preparedSchema.parse(
      JSON.parse(
        Buffer.from(id.slice(pendingPrefix.length), 'base64url').toString(
          'utf8',
        ),
      ),
    );
  } catch {
    throw new CloudError('configuration');
  }
}

/** Public-client OAuth and ID-bound, revision-conditional Markdown operations. */
export class Dropbox implements CloudProvider {
  readonly provider = 'dropbox' as const;
  readonly organization: CloudOrganization = {
    metadata: async (access, id) => {
      const meta = await this.metadata(access, id);
      return {
        id: meta.id,
        parents: meta.id === 'root' ? [] : [await this.parent(access, meta)],
      };
    },

    createdBy: (access, id, operationId) =>
      this.createdBy(access, id, operationId),

    contentValidator: async (access, id) => {
      const meta = await this.metadata(access, id);
      if (!meta.rev) throw new CloudError('unsupported');
      return { etag: `"${meta.rev}"` };
    },

    inspectItem: async (access, id) => {
      const meta = await this.metadata(access, id);
      return this.item(
        meta,
        meta.id === 'root' ? 'root' : await this.parent(access, meta),
        true,
      );
    },

    prepareCreate: (access, folderId, name, operationId) =>
      this.prepareCreation(access, folderId, name, operationId, 'folder'),

    // move_v2 has no atomic source-ID/revision/location precondition. Path
    // moves can affect replacements; ID moves can follow an unchecked relocation.
    // Retain read-only organization methods for recovering older pending moves.
    prepareMove: async () => {
      throw new CloudError('unsupported');
    },

    move: async () => {
      throw new CloudError('unsupported');
    },

    createFolder: (access, id, folderId, name, operationId, authorize) =>
      this.createFolder(access, id, folderId, name, operationId, authorize),
  };
  private templates = new Map<string, Promise<string>>();
  constructor(
    private readonly endpoints: DropboxEndpoints = production,
    private readonly callbackPort = DROPBOX_CALLBACK_PORT,
  ) {}

  authorizationScopes(editing: boolean): readonly string[] {
    return editing
      ? [...DROPBOX_READ_SCOPES, ...DROPBOX_WRITE_SCOPES]
      : DROPBOX_READ_SCOPES;
  }

  canWrite(tokens: CloudTokens): boolean {
    return DROPBOX_WRITE_SCOPES.every((scope) =>
      tokens.scopes?.includes(scope),
    );
  }

  private async request(
    url: string,
    init: RequestInit,
    safeRead: boolean,
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
          await new Promise((resolve) =>
            setTimeout(resolve, 250 * 2 ** attempt),
          );
          continue;
        }
        throw new CloudError(safeRead ? 'network' : 'unconfirmed');
      }
      if (response.ok) return response;
      const body: unknown = await response.json().catch(() => null);
      const parsed = z
        .object({
          error_summary: z.string().optional(),
          error: z
            .union([z.string(), z.object({ '.tag': z.string() }).passthrough()])
            .optional(),
        })
        .safeParse(body);
      const detail = parsed.success
        ? `${parsed.data.error_summary ?? ''} ${typeof parsed.data.error === 'string' ? parsed.data.error : (parsed.data.error?.['.tag'] ?? '')}`
        : '';
      if (
        safeRead &&
        attempt < 2 &&
        (response.status === 429 || response.status >= 500)
      ) {
        const retry = Number(response.headers.get('Retry-After'));
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Number.isFinite(retry) && retry > 0
              ? Math.min(retry * 1000, 3000)
              : 250 * 2 ** attempt,
          ),
        );
        continue;
      }
      if (
        response.status === 401 ||
        /invalid_grant|invalid_access_token|expired_access_token/.test(detail)
      )
        throw new CloudError('auth');
      if (/insufficient_space|quota|traffic_limit/.test(detail))
        throw new CloudError('quota');
      if (response.status === 429 || /too_many_write_operations/.test(detail))
        throw new CloudError('throttled');
      if (/properties_error/.test(detail)) throw new CloudError('unconfirmed'); // Dropbox may have committed the bytes without properties.
      if (/not_found/.test(detail)) throw new CloudError('missing');
      if (/to\/conflict/.test(detail)) throw new CloudError('duplicate');
      if (/conflict/.test(detail)) throw new CloudError('conflict');
      if (
        response.status === 403 ||
        /no_write_permission|restricted_content|missing_scope|access_restricted/.test(
          detail,
        )
      )
        throw new CloudError('permission');
      if (response.status >= 500)
        throw new CloudError(safeRead ? 'network' : 'unconfirmed');
      throw new CloudError('configuration');
    }
  }

  private headers(access: string, rooted = true): Record<string, string> {
    return {
      Authorization: `Bearer ${access}`,
      ...(rooted ? { 'Dropbox-API-Path-Root': '{".tag":"home"}' } : {}),
    };
  }

  private async rpc(
    access: string,
    route: string,
    body: unknown,
    safeRead = true,
  ): Promise<unknown> {
    const response = await this.request(
      new URL(route, this.endpoints.api).toString(),
      {
        method: 'POST',
        headers: {
          ...this.headers(
            access,
            route.startsWith('files/') ||
              route.startsWith('file_properties/properties/'),
          ),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      safeRead,
    );
    return response.json();
  }

  private async token(
    registration: CloudRegistration,
    form: Record<string, string>,
    previousRefresh = '',
    previousScopes: readonly string[] = DROPBOX_READ_SCOPES,
  ): Promise<CloudTokens> {
    // PKCE uses the public app key. The Dropbox app secret is never accepted or sent.
    const response = await this.request(
      this.endpoints.token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: registration.clientId,
          ...form,
        }),
      },
      false,
    );
    const result = z
      .object({
        access_token: z.string().min(1),
        refresh_token: z.string().optional(),
        expires_in: z.number().positive(),
        scope: z.string().optional(),
      })
      .safeParse(await response.json());
    if (!result.success) throw new CloudError('auth');
    const scopes = result.data.scope?.split(' ') ?? [...previousScopes];
    if (!DROPBOX_READ_SCOPES.every((scope) => scopes.includes(scope)))
      throw new CloudError('permission');
    const refresh = result.data.refresh_token ?? previousRefresh;
    if (!refresh) throw new CloudError('auth');
    return {
      access: result.data.access_token,
      refresh,
      expires: Date.now() + result.data.expires_in * 1000,
      scopes,
    };
  }

  refresh(registration: CloudRegistration, refresh: string, scopes?: string[]) {
    return this.token(
      registration,
      { grant_type: 'refresh_token', refresh_token: refresh },
      refresh,
      scopes,
    );
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

  async account(access: string): Promise<{ id: string; name: string }> {
    const result = z
      .object({
        account_id: z.string().min(1),
        email: z.string().optional(),
        name: z.object({ display_name: z.string() }),
      })
      .safeParse(await this.rpc(access, 'users/get_current_account', null));
    if (!result.success) throw new CloudError('auth');
    return {
      id: result.data.account_id,
      name: result.data.email ?? result.data.name.display_name,
    };
  }

  private async metadata(access: string, id: string): Promise<Metadata> {
    if (id === 'root') return root;
    const plan = prepared(id);
    const meta = parseMetadata(
      await this.rpc(access, 'files/get_metadata', {
        path: plan?.path ?? id,
        include_deleted: false,
        ...(plan
          ? {
              include_property_groups: {
                '.tag': 'filter_some',
                filter_some: [plan.templateId],
              },
            }
          : {}),
      }),
    );
    if (plan && !this.matches(meta, plan.templateId, plan.operationId))
      throw new CloudError('unconfirmed');
    if (!plan && /^id:[^/\\\s]+$/.test(id) && meta.id !== id)
      throw new CloudError('conflict');
    return meta;
  }

  private matches(
    meta: Metadata,
    templateId: string,
    operationId: string,
  ): boolean {
    return Boolean(
      meta.property_groups?.some(
        (group) =>
          group.template_id === templateId &&
          group.fields.some(
            (field) => field.name === fieldName && field.value === operationId,
          ),
      ),
    );
  }

  private item(meta: Metadata, parent: string, editing = false): RemoteItem {
    const kind =
      meta['.tag'] === 'folder'
        ? 'folder'
        : meta.is_downloadable !== false &&
            markdown.some((ext) => meta.name.toLowerCase().endsWith(`.${ext}`))
          ? 'markdown'
          : 'unsupported';
    return {
      id: meta.id,
      name: meta.name,
      kind,
      parents: meta.id === 'root' ? [] : [parent],
      modifiedTime: meta.server_modified,
      revision: meta.rev,
      contentRevision: meta.rev,
      validator: meta.rev ? `"${meta.rev}"` : undefined,
      editable:
        editing &&
        kind === 'markdown' &&
        Boolean(meta.rev) &&
        meta.sharing_info?.read_only !== true,
      ...(!editing || meta.sharing_info?.read_only
        ? { readOnlyReason: 'permission' as const }
        : {}),
    };
  }

  private async parent(access: string, meta: Metadata): Promise<string> {
    const path = meta.path_lower ?? meta.path_display;
    if (!path) throw new CloudError('unsupported');
    const parent = path.slice(0, path.lastIndexOf('/'));
    return parent ? (await this.metadata(access, parent)).id : 'root';
  }

  async list(
    access: string,
    folderId: string,
    driveId?: string,
    page?: string,
  ): Promise<RemotePage> {
    if (driveId) throw new CloudError('unsupported');
    const folder = await this.metadata(access, folderId);
    if (folder['.tag'] !== 'folder') throw new CloudError('unsupported');
    const result = z
      .object({
        entries: z.array(z.unknown()),
        cursor: z.string(),
        has_more: z.boolean(),
      })
      .safeParse(
        await this.rpc(
          access,
          page ? 'files/list_folder/continue' : 'files/list_folder',
          page
            ? { cursor: page }
            : {
                path: folderId === 'root' ? '' : folderId,
                recursive: false,
                include_deleted: false,
                limit: 100,
              },
        ),
      );
    if (!result.success) throw new CloudError('network');
    const items = result.data.entries
      .map(parseMetadata)
      .map((meta) => this.item(meta, folderId));
    items.sort(
      (a, b) =>
        Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
        a.name.localeCompare(b.name),
    );
    return {
      items,
      nextPage: result.data.has_more ? result.data.cursor : undefined,
    };
  }

  async drives(): Promise<RemotePage> {
    throw new CloudError('unsupported');
  }

  async read(
    access: string,
    id: string,
    editing = false,
  ): Promise<RemoteContents> {
    const before = await this.metadata(access, id);
    if (
      this.item(before, 'root').kind !== 'markdown' ||
      (before.size ?? 0) > limit
    )
      throw new CloudError('unsupported');
    const response = await this.request(
      new URL('files/download', this.endpoints.content).toString(),
      {
        method: 'POST',
        headers: {
          ...this.headers(access),
          'Dropbox-API-Arg': JSON.stringify({ path: before.id }),
        },
      },
      true,
    );
    let meta: Metadata;
    try {
      meta = parseMetadata(
        JSON.parse(response.headers.get('Dropbox-API-Result') ?? 'null'),
      );
    } catch {
      throw new CloudError('network');
    }
    if (meta.id !== before.id || !meta.rev || (meta.size ?? 0) > limit)
      throw new CloudError('conflict');
    const reader = response.body?.getReader();
    if (!reader) throw new CloudError('network');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new CloudError('unsupported');
      }
      chunks.push(chunk.value);
    }
    const bytes = Buffer.concat(chunks);
    if (meta.content_hash && dropboxContentHash(bytes) !== meta.content_hash)
      throw new CloudError('network');
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new CloudError('unsupported');
    }
    return {
      item: this.item(
        { ...meta, sharing_info: meta.sharing_info ?? before.sharing_info },
        await this.parent(access, meta),
        editing,
      ),
      content,
    };
  }

  private async upload(
    access: string,
    args: Record<string, unknown>,
    content: string,
    authorize: () => void,
  ): Promise<Metadata> {
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > limit) throw new CloudError('unsupported');
    const arg = JSON.stringify({
      ...args,
      autorename: false,
      strict_conflict: true,
      content_hash: dropboxContentHash(bytes),
    }).replace(
      /[\u007f-\uffff]/g,
      (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    authorize();
    const response = await this.request(
      new URL('files/upload', this.endpoints.content).toString(),
      {
        method: 'POST',
        headers: {
          ...this.headers(access),
          'Dropbox-API-Arg': arg,
          'Content-Type': 'application/octet-stream',
        },
        body: content,
      },
      false,
    );
    try {
      const meta = parseMetadata(await response.json());
      if (!meta.rev || meta.content_hash !== dropboxContentHash(bytes))
        throw new Error();
      return meta;
    } catch {
      throw new CloudError('unconfirmed');
    }
  }

  async update(
    access: string,
    id: string,
    validator: string,
    content: string,
    authorize: () => void,
  ): Promise<RemoteContents> {
    if (!/^id:[^/\\\s]+$/.test(id) || !/^"[0-9a-f]{9,}"$/.test(validator))
      throw new CloudError('configuration');
    const previous = await this.metadata(access, id);
    if (this.item(previous, 'root').kind !== 'markdown')
      throw new CloudError('unsupported');
    if (previous.sharing_info?.read_only) throw new CloudError('permission');
    const meta = await this.upload(
      access,
      { path: id, mode: { '.tag': 'update', update: validator.slice(1, -1) } },
      content,
      authorize,
    );
    if (meta.id !== id) throw new CloudError('unconfirmed');
    try {
      return {
        item: this.item(meta, await this.parent(access, meta), true),
        content,
      };
    } catch {
      throw new CloudError('unconfirmed');
    }
  }

  private async template(access: string, allowCreate = true): Promise<string> {
    const existing = this.templates.get(access);
    if (existing) return existing;
    const work = (async () => {
      const listed = z
        .object({ template_ids: z.array(z.string()) })
        .parse(
          await this.rpc(
            access,
            'file_properties/templates/list_for_user',
            null,
          ),
        );
      for (const id of listed.template_ids) {
        const schema = z
          .object({
            name: z.string(),
            fields: z.array(
              z.object({
                name: z.string(),
                type: z
                  .union([z.string(), z.object({ '.tag': z.string() })])
                  .transform((value) =>
                    typeof value === 'string' ? value : value['.tag'],
                  ),
              }),
            ),
          })
          .parse(
            await this.rpc(access, 'file_properties/templates/get_for_user', {
              template_id: id,
            }),
          );
        if (
          schema.name === markerName &&
          schema.fields.length === 1 &&
          schema.fields.some(
            (field) => field.name === fieldName && field.type === 'string',
          )
        )
          return id;
      }
      if (!allowCreate) throw new CloudError('missing');
      const added = await this.rpc(
        access,
        'file_properties/templates/add_for_user',
        {
          name: markerName,
          description:
            'Identifies a file or folder created by an MKEditor operation.',
          fields: [
            {
              name: fieldName,
              description: 'MKEditor creation operation',
              type: { '.tag': 'string' },
            },
          ],
        },
        false,
      );
      return z.object({ template_id: z.string().min(1) }).parse(added)
        .template_id;
    })();
    if (this.templates.size >= 20)
      this.templates.delete(this.templates.keys().next().value!);
    this.templates.set(access, work);
    try {
      return await work;
    } catch (error) {
      this.templates.delete(access);
      throw error;
    }
  }

  async prepareCreate(
    access: string,
    folderId: string,
    name: string,
    operationId?: string,
  ): Promise<string> {
    return this.prepareCreation(access, folderId, name, operationId, 'file');
  }

  private async prepareCreation(
    access: string,
    folderId: string,
    name: string,
    operationId: string | undefined,
    kind: 'file' | 'folder',
  ): Promise<string> {
    if (
      !operationId ||
      !name ||
      /[/\\]/.test(name) ||
      name === '.' ||
      name === '..' ||
      (kind === 'file' && !/\.md$/i.test(name)) ||
      [...name].some((character) => character.charCodeAt(0) < 32) ||
      name.endsWith(' ') ||
      name.length > 255
    )
      throw new CloudError('configuration');
    const folder = await this.metadata(access, folderId);
    if (folder['.tag'] !== 'folder') throw new CloudError('unsupported');
    if (folder.sharing_info?.read_only) throw new CloudError('permission');
    // Folder-relative IDs keep creation bound to the selected folder even if it moves.
    const path = folderId === 'root' ? `/${name}` : `${folder.id}/${name}`;
    try {
      await this.metadata(access, path);
      throw new CloudError('duplicate');
    } catch (error) {
      if (!(error instanceof CloudError) || error.code !== 'missing')
        throw error;
    }
    const plan = {
      kind,
      path,
      folderId,
      operationId,
      templateId: await this.template(access),
    };
    const id =
      pendingPrefix + Buffer.from(JSON.stringify(plan)).toString('base64url');
    if (id.length > 1024) throw new CloudError('unsupported');
    return id;
  }

  private async createFolder(
    access: string,
    id: string,
    folderId: string,
    name: string,
    operationId: string,
    authorize: () => void,
  ): Promise<RemoteItem> {
    const plan = prepared(id);
    if (
      !plan ||
      plan.kind !== 'folder' ||
      plan.folderId !== folderId ||
      plan.operationId !== operationId ||
      plan.path.split('/').at(-1) !== name
    )
      throw new CloudError('configuration');
    const folder = await this.metadata(access, folderId);
    if (folder['.tag'] !== 'folder') throw new CloudError('unsupported');
    if (folder.sharing_info?.read_only) throw new CloudError('permission');
    // create_folder_v2 accepts paths, unlike upload's folder-ID-relative paths.
    const path =
      folderId === 'root'
        ? `/${name}`
        : `${folder.path_display ?? folder.path_lower}/${name}`;
    if (!path.startsWith('/')) throw new CloudError('unsupported');
    authorize();
    let response: unknown;
    try {
      response = await this.rpc(
        access,
        'files/create_folder_v2',
        { path, autorename: false },
        false,
      );
    } catch (error) {
      if (error instanceof CloudError && error.code === 'conflict')
        throw new CloudError('duplicate');
      if (error instanceof CloudError) throw error;
      throw new CloudError('unconfirmed');
    }
    try {
      const result = z
        .object({
          metadata: metadataSchema.extend({
            '.tag': z.literal('folder').default('folder'),
          }),
        })
        .parse(response).metadata;
      if (
        result.name !== name ||
        (await this.parent(access, result)) !== folderId
      )
        throw new CloudError('unconfirmed');
      authorize();
      // Mark the acknowledged ID, never a same-name replacement at its old path.
      await this.rpc(
        access,
        'file_properties/properties/add',
        {
          path: result.id,
          property_groups: [
            {
              template_id: plan.templateId,
              fields: [{ name: fieldName, value: operationId }],
            },
          ],
        },
        false,
      );
      return this.item(result, folderId, true);
    } catch {
      // The folder may exist even if adding its recovery marker was interrupted.
      throw new CloudError('unconfirmed');
    }
  }

  async create(
    access: string,
    id: string,
    folderId: string,
    _name: string,
    content: string,
    operationId: string,
    authorize: () => void,
  ): Promise<RemoteContents> {
    const plan = prepared(id);
    if (
      !plan ||
      plan.kind !== 'file' ||
      plan.operationId !== operationId ||
      plan.folderId !== folderId
    )
      throw new CloudError('configuration');
    let meta: Metadata;
    try {
      meta = await this.upload(
        access,
        {
          path: plan.path,
          mode: { '.tag': 'add' },
          property_groups: [
            {
              template_id: plan.templateId,
              fields: [{ name: fieldName, value: operationId }],
            },
          ],
        },
        content,
        authorize,
      );
    } catch (error) {
      if (error instanceof CloudError && error.code === 'conflict')
        throw new CloudError('duplicate');
      throw error;
    }
    return { item: this.item(meta, folderId, true), content };
  }

  async createdBy(
    access: string,
    id: string,
    operationId: string,
  ): Promise<boolean> {
    const plan = prepared(id);
    if (!plan) {
      if (!/^id:[^/\\\s]+$/.test(id)) return false;
      let templateId: string;
      try {
        templateId = await this.template(access, false);
      } catch (error) {
        if (error instanceof CloudError && error.code === 'missing')
          return false;
        throw error;
      }
      const meta = parseMetadata(
        await this.rpc(access, 'files/get_metadata', {
          path: id,
          include_property_groups: {
            '.tag': 'filter_some',
            filter_some: [templateId],
          },
        }),
      );
      return meta.id === id && this.matches(meta, templateId, operationId);
    }
    if (plan.operationId !== operationId) return false;
    return this.matches(
      await this.metadata(access, id),
      plan.templateId,
      operationId,
    );
  }
}
