import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import type { DriveEndpoints } from '../../src/app/lib/cloud/GoogleDrive';
import { createHash } from 'crypto';

interface CreatedItem {
  id: string;
  name: string;
  appProperties: Record<string, string>;
  mimeType?: string;
  parents?: string[];
  content?: string;
}

/** Deterministic HTTP fixture for the production adapter. No live credentials. */
export async function driveFixture() {
  const calls: {
    method: string;
    url: URL;
    authorization?: string;
    body: string;
    ifMatch?: string;
  }[] = [];
  const state = {
    revoked: false,
    revision: '1',
    contentRevision: undefined as string | undefined,
    parents: ['root'],
    content: '# Remote Markdown',
    trashed: false,
    accountId: 'account-a',
    refreshes: 0,
    scopes: 'https://www.googleapis.com/auth/drive.readonly',
    editable: true,
    shared: false,
    duplicate: false,
    loseWrite: false,
    writeWait: undefined as Promise<void> | undefined,
    // Opt-in multi-client storage; ordinary fixture behavior stays unchanged.
    creations: undefined as Map<string, CreatedItem> | undefined,
    generatedIds: undefined as string[] | undefined,
    created: undefined as
      | {
          id: string;
          name: string;
          appProperties: Record<string, string>;
          mimeType?: string;
          parents?: string[];
        }
      | undefined,
    refreshWait: undefined as Promise<void> | undefined,
    override: undefined as
      ((url: URL, response: ServerResponse) => boolean) | undefined,
    tokenForm: undefined as URLSearchParams | undefined,
  };
  const send = (response: ServerResponse, value: unknown, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  };

  const meta = (
    id = 'markdown',
    name = 'notes.md',
    mimeType = 'text/markdown',
  ) => ({
    id,
    name,
    mimeType,
    version: state.revision,
    headRevisionId: state.contentRevision ?? `content-${state.revision}`,
    md5Checksum: createHash('md5').update(state.content).digest('hex'),
    capabilities: {
      canEdit: state.editable,
      canModifyContent: state.editable,
      canAddChildren: state.editable,
    },
    ...(state.shared ? { driveId: 'team' } : {}),
    modifiedTime: '2026-01-01T00:00:00Z',
    parents: id === 'markdown' ? state.parents : ['root'],
    size: String(Buffer.byteLength(state.content)),
    trashed: state.trashed,
  });
  const server = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url!, 'http://127.0.0.1');
      let body = '';
      for await (const chunk of request) body += chunk;
      calls.push({
        method: request.method!,
        url,
        body,
        authorization: request.headers.authorization,
        ifMatch: request.headers['if-match'] as string | undefined,
      });
      if (state.override?.(url, response)) return;
      if (url.pathname === '/token') {
        state.tokenForm = new URLSearchParams(body);
        if (state.tokenForm.get('grant_type') === 'refresh_token') {
          state.refreshes++;
          await state.refreshWait;
        }
        if (state.revoked) {
          send(response, { error: 'invalid_grant' }, 400);
          return;
        }
        send(response, {
          access_token: 'fixture-access',
          refresh_token: 'fixture-refresh',
          expires_in: 3600,
          scope: state.scopes,
        });
        return;
      }
      if (request.headers.authorization !== 'Bearer fixture-access') {
        send(response, { error: {} }, 401);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/drive/v3/files') {
        const created: CreatedItem = JSON.parse(body);
        state.created = created;
        state.creations?.set(created.id, created);
        await state.writeWait;
        if (state.loseWrite) {
          response.destroy();
          return;
        }
        send(response, { id: created.id });
        return;
      }
      if (request.method === 'PATCH') {
        if (request.headers['if-match'] !== `"etag-${state.revision}"`) {
          send(response, { error: {} }, 412);
          return;
        }
        await state.writeWait;
        state.contentRevision ??= `content-${state.revision}`;
        state.parents = state.parents.filter(
          (id) => id !== url.searchParams.get('removeParents'),
        );
        state.parents.push(url.searchParams.get('addParents')!);
        state.revision = String(Number(state.revision) + 1);
        if (state.loseWrite) {
          response.destroy();
          return;
        }
        send(response, { id: url.pathname.split('/').pop() });
        return;
      }
      if (request.method === 'PUT' || request.method === 'POST') {
        const segments = body.split('\r\n\r\n');
        const metadata = JSON.parse(segments[1].split('\r\n--')[0]);
        const content = segments
          .slice(2)
          .join('\r\n\r\n')
          .replace(/\r\n--[^\r\n]+--\r\n$/, '');
        if (
          request.method === 'PUT' &&
          request.headers['if-match'] !== `"etag-${state.revision}"`
        ) {
          send(response, { error: {} }, 412);
          return;
        }
        await state.writeWait;
        state.content = content;
        state.revision = String(Number(state.revision) + 1);
        state.contentRevision = `content-${state.revision}`;
        if (request.method === 'POST') {
          state.created = metadata;
          state.creations?.set(metadata.id, { ...metadata, content });
        }
        if (state.loseWrite) {
          response.destroy();
          return;
        }
        send(response, {
          id: state.created?.id ?? 'markdown',
          etag: `"etag-${state.revision}"`,
          version: state.revision,
          headRevisionId: state.contentRevision ?? `content-${state.revision}`,
        });
        return;
      }
      if (url.pathname.startsWith('/drive/v2/files/')) {
        send(response, {
          id: url.pathname.split('/').pop(),
          etag: `"etag-${state.revision}"`,
          version: state.revision,
          headRevisionId: state.contentRevision ?? `content-${state.revision}`,
        });
        return;
      }
      if (url.pathname === '/drive/v3/files/generateIds') {
        send(response, { ids: [state.generatedIds?.shift() ?? 'created-id'] });
        return;
      }
      if (url.pathname === '/drive/v3/about') {
        send(response, {
          user: {
            permissionId: state.accountId,
            emailAddress: `${state.accountId}@example.test`,
          },
        });
        return;
      }
      if (url.pathname === '/drive/v3/drives') {
        send(response, { drives: [{ id: 'team', name: 'Shared drive' }] });
        return;
      }
      if (url.pathname === '/drive/v3/files') {
        if (url.searchParams.get('q')?.includes(' and name = ')) {
          const query = url.searchParams.get('q')!;
          const decode = (value?: string) => value?.replace(/\\(.)/g, '$1');
          const name = decode(/ and name = '((?:\\.|[^'])*)'/.exec(query)?.[1]);
          const parent = decode(
            /^'((?:\\.|[^'])*)' in parents/.exec(query)?.[1],
          );
          send(response, {
            files: state.duplicate
              ? [{ id: 'existing' }]
              : [...(state.creations?.values() ?? [])]
                  .filter(
                    (file) =>
                      file.name === name &&
                      (file.parents ?? ['root']).includes(parent!),
                  )
                  .map((file) => ({ id: file.id })),
          });
          return;
        }
        const second = url.searchParams.get('pageToken') === 'second';
        send(response, {
          files: second
            ? [meta('second')]
            : [
                meta(),
                meta('folder', 'Folder', 'application/vnd.google-apps.folder'),
                meta(
                  'native',
                  'Google.md',
                  'application/vnd.google-apps.document',
                ),
                meta('pdf', 'document.pdf', 'application/pdf'),
                {
                  ...meta(
                    'shortcut',
                    'Shortcut.md',
                    'application/vnd.google-apps.shortcut',
                  ),
                  shortcutDetails: {
                    targetId: 'markdown',
                    targetMimeType: 'text/markdown',
                    targetResourceKey: 'fixture-resource',
                  },
                },
              ],
          ...(second ? {} : { nextPageToken: 'second' }),
        });
        return;
      }
      const id = decodeURIComponent(url.pathname.split('/').pop()!);
      const created = state.creations?.get(id);
      if (created) {
        if (url.searchParams.get('alt') === 'media')
          response.end(created.content ?? '');
        else
          send(response, {
            ...meta(id, created.name, created.mimeType),
            appProperties: created.appProperties,
            parents: created.parents ?? ['root'],
            md5Checksum: createHash('md5')
              .update(created.content ?? '')
              .digest('hex'),
          });
        return;
      }
      if (id === 'gone') {
        send(response, { error: {} }, 404);
        return;
      }
      if (url.searchParams.get('alt') === 'media') {
        response.end(state.content);
        return;
      }
      if (id === state.created?.id) {
        send(response, {
          ...meta(
            id,
            state.created.name,
            state.created.mimeType ?? 'text/markdown',
          ),
          parents: state.created.parents ?? ['root'],
          appProperties: state.created.appProperties,
        });
        return;
      }
      if (id === 'root' || id === 'folder') {
        send(
          response,
          meta(id, 'Folder', 'application/vnd.google-apps.folder'),
        );
        return;
      }
      if (id === 'shortcut') {
        send(response, {
          ...meta(id, 'Shortcut.md', 'application/vnd.google-apps.shortcut'),
          shortcutDetails: {
            targetId: 'markdown',
            targetMimeType: 'text/markdown',
          },
        });
        return;
      }
      send(
        response,
        id === 'native'
          ? meta(id, 'Google.md', 'application/vnd.google-apps.document')
          : meta(id),
      );
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const endpoints: DriveEndpoints = {
    authorize: `${base}/authorize`,
    token: `${base}/token`,
    api: `${base}/drive/v3/`,
  };
  return {
    endpoints,
    state,
    calls,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
