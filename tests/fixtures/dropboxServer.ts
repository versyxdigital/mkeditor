import { createServer, type ServerResponse } from 'http';
import { createHash } from 'crypto';
import type { DropboxEndpoints } from '../../src/app/lib/cloud/Dropbox';

export interface DropboxFile {
  id: string;
  name: string;
  path: string;
  folder?: boolean;
  content: string;
  revision: number;
  readOnly?: boolean;
  groups?: { template_id: string; fields: { name: string; value: string }[] }[];
}
function hash(value: string | Buffer) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const chunks: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += 4194304)
    chunks.push(
      createHash('sha256')
        .update(bytes.subarray(i, i + 4194304))
        .digest(),
    );
  return createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
}

export async function dropboxFixture() {
  const files = new Map<string, DropboxFile>([
    [
      'id:docs',
      {
        id: 'id:docs',
        name: 'Documents',
        path: '/Documents',
        folder: true,
        content: '',
        revision: 1,
      },
    ],
    [
      'id:markdown',
      {
        id: 'id:markdown',
        name: 'notes.md',
        path: '/notes.md',
        content: '# Dropbox notes',
        revision: 1,
      },
    ],
    [
      'id:image',
      {
        id: 'id:image',
        name: 'image.png',
        path: '/image.png',
        content: 'not markdown',
        revision: 1,
      },
    ],
  ]);
  const state = {
    account: 'dbid:fixture',
    scopes:
      'account_info.read files.metadata.read files.content.read files.content.write files.metadata.write',
    revoked: false,
    offline: false,
    loseWriteReply: false,
    loseFolderReply: false,
    loseMoveReply: false,
    losePropertyReply: false,
    omitMarker: false,
    writeWait: undefined as Promise<void> | undefined,
    beforeWrite: undefined as (() => void) | undefined,
    writes: 0,
    creates: 0,
    folderCreates: 0,
    moves: 0,
    refreshes: 0,
    nextId: 1,
    lastUpload: undefined as Record<string, unknown> | undefined,
    lastToken: undefined as URLSearchParams | undefined,
    requests: [] as { route: string; body: unknown; root?: string }[],
    rawDownload: undefined as Buffer | undefined,
    error: undefined as
      | { route: string; status: number; summary: string; count?: number }
      | undefined,
  };
  const templates = new Map<
    string,
    {
      name: string;
      fields: { name: string; type: string | { '.tag': string } }[];
    }
  >();
  function resolve(path: string): DropboxFile | undefined {
    if (/^id:[^/]+\//.test(path)) {
      const [folderId, ...parts] = path.split('/');
      const parent = files.get(folderId);
      return parent ? resolve(`${parent.path}/${parts.join('/')}`) : undefined;
    }
    return (
      files.get(path) ??
      [...files.values()].find(
        (file) => file.path.toLowerCase() === path.toLowerCase(),
      )
    );
  }

  const metadata = (file: DropboxFile) => ({
    '.tag': file.folder ? 'folder' : 'file',
    id: file.id,
    name: file.name,
    path_lower: file.path.toLowerCase(),
    path_display: file.path,
    property_groups: file.groups ?? [],
    sharing_info: { read_only: Boolean(file.readOnly) },
    ...(!file.folder
      ? {
          rev: file.revision.toString(16).padStart(9, '0'),
          size: Buffer.byteLength(file.content),
          server_modified: '2026-11-24T12:00:00Z',
          content_hash: hash(state.rawDownload ?? file.content),
          sharing_info: { read_only: Boolean(file.readOnly) },
          property_groups: file.groups ?? [],
        }
      : {}),
  });

  const json = (response: ServerResponse, value: unknown, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  };

  const error = (response: ServerResponse, summary: string, status = 409) =>
    json(
      response,
      { error_summary: summary, error: { '.tag': summary.split('/')[0] } },
      status,
    );
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/authorize') {
      const target = new URL(url.searchParams.get('redirect_uri')!);
      target.search = new URLSearchParams({
        state: url.searchParams.get('state')!,
        code: 'fixture-code',
      }).toString();
      response.writeHead(302, { Location: target.toString() });
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks),
      text = bytes.toString('utf8');
    if (url.pathname === '/token') {
      const form = new URLSearchParams(text);
      state.lastToken = form;
      if (state.revoked) return json(response, { error: 'invalid_grant' }, 400);
      if (form.get('grant_type') === 'refresh_token') state.refreshes++;
      return json(response, {
        access_token: `dropbox-access-${state.refreshes}`,
        refresh_token: 'dropbox-fixture-refresh',
        expires_in: 3600,
        scope: state.scopes,
      });
    }
    const route = url.pathname.replace(/^\/2\//, '');
    let body: Record<string, unknown> = {};
    try {
      body =
        JSON.parse(
          String((request.headers['dropbox-api-arg'] ?? text) || '{}'),
        ) ?? {};
    } catch {
      return error(response, 'invalid_json', 400);
    }
    state.requests.push({
      route,
      body,
      root: request.headers['dropbox-api-path-root'] as string | undefined,
    });
    if (state.revoked) return error(response, 'invalid_access_token', 401);
    if (state.offline) return error(response, 'offline', 503);
    if (state.error?.route === route && (state.error.count ?? 1) > 0) {
      state.error.count = (state.error.count ?? 1) - 1;
      return error(response, state.error.summary, state.error.status);
    }
    if (route === 'users/get_current_account')
      return json(response, {
        account_id: state.account,
        email: 'dropbox-fixture@example.test',
        name: { display_name: 'Fixture user' },
        root_info: {
          '.tag': 'user',
          root_namespace_id: 'fixture-home',
          home_namespace_id: 'fixture-home',
        },
      });
    if (route === 'file_properties/templates/list_for_user')
      return json(response, { template_ids: [...templates.keys()] });
    if (route === 'file_properties/templates/get_for_user')
      return json(response, templates.get(String(body.template_id)));
    if (route === 'file_properties/templates/add_for_user') {
      const id = `ptid:${templates.size + 1}`;
      templates.set(
        id,
        body as unknown as {
          name: string;
          fields: { name: string; type: string | { '.tag': string } }[];
        },
      );
      return json(response, { template_id: id });
    }
    if (route === 'files/create_folder_v2') {
      state.beforeWrite?.();
      state.beforeWrite = undefined;
      const path = String(body.path);
      if (!path.startsWith('/') || body.autorename !== false)
        return error(response, 'invalid_path', 400);
      if (resolve(path)) return error(response, 'path/conflict/folder');
      const parentPath = path.slice(0, path.lastIndexOf('/'));
      const parent = parentPath ? resolve(parentPath) : undefined;
      if (parentPath && !parent?.folder)
        return error(response, 'path/not_found');
      if (parent?.readOnly) return error(response, 'path/no_write_permission');
      const file = {
        id: `id:folder-${state.nextId++}`,
        name: path.split('/').at(-1)!,
        path,
        content: '',
        folder: true,
        revision: 1,
      };
      files.set(file.id, file);
      state.folderCreates++;
      if (state.loseFolderReply) {
        state.loseFolderReply = false;
        response.destroy();
        return;
      }
      const { '.tag': _tag, ...folderMetadata } = metadata(file);
      return json(response, { metadata: folderMetadata });
    }
    if (route === 'file_properties/properties/add') {
      const file = resolve(String(body.path));
      if (!file) return error(response, 'path/not_found');
      if (!state.omitMarker)
        file.groups = body.property_groups as DropboxFile['groups'];
      if (state.losePropertyReply) {
        state.losePropertyReply = false;
        response.destroy();
        return;
      }
      return json(response, {});
    }
    if (route === 'files/move_v2') {
      state.beforeWrite?.();
      state.beforeWrite = undefined;
      const file = resolve(String(body.from_path));
      if (!file) return error(response, 'from_lookup/not_found');
      if (file.readOnly)
        return error(response, 'from_write/no_write_permission');
      const target = String(body.to_path);
      if (body.autorename !== false || body.allow_ownership_transfer !== false)
        return error(response, 'invalid_options', 400);
      if (resolve(target)) return error(response, 'to/conflict/file');
      const parentName = target.slice(0, target.lastIndexOf('/'));
      const parent = parentName ? resolve(parentName) : undefined;
      if (parentName && !parent?.folder) return error(response, 'to/not_found');
      if (parent?.readOnly) return error(response, 'to/no_write_permission');
      file.path = `${parent?.path ?? ''}/${target.split('/').at(-1)}`;
      file.name = file.path.split('/').at(-1)!;
      state.moves++;
      await state.writeWait;
      if (state.loseMoveReply) {
        state.loseMoveReply = false;
        response.destroy();
        return;
      }
      return json(response, { metadata: metadata(file) });
    }
    if (route === 'files/get_metadata') {
      const file = resolve(String(body.path));
      return file
        ? json(response, metadata(file))
        : error(response, 'path/not_found');
    }
    if (
      route === 'files/list_folder' ||
      route === 'files/list_folder/continue'
    ) {
      const parent = body.path ? resolve(String(body.path)) : undefined;
      const prefix = parent?.path ?? '';
      const entries = [...files.values()]
        .filter(
          (file) =>
            file.path.slice(0, file.path.lastIndexOf('/')).toLowerCase() ===
            prefix.toLowerCase(),
        )
        .map(metadata);
      return json(response, {
        entries,
        has_more: false,
        cursor: 'fixture-cursor',
      });
    }
    if (route === 'files/download') {
      const file = resolve(String(body.path));
      if (!file || file.folder) return error(response, 'path/not_found');
      const { '.tag': _tag, ...downloadMetadata } = metadata(file);
      const header = JSON.stringify(downloadMetadata).replace(
        /[\u007f-\uffff]/g,
        (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
      );
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Result': header,
      });
      response.end(state.rawDownload ?? file.content);
      return;
    }
    if (route === 'files/upload') {
      state.lastUpload = body;
      state.beforeWrite?.();
      state.beforeWrite = undefined;
      const mode = body.mode as { '.tag': string; update?: string };
      const path = String(body.path);
      let file = resolve(path);
      if (mode['.tag'] === 'update') {
        if (!file) return error(response, 'path/not_found');
        if (file.readOnly) return error(response, 'path/no_write_permission');
        if (mode.update !== file.revision.toString(16).padStart(9, '0'))
          return error(response, 'path/conflict/file');
      } else {
        if (file) return error(response, 'path/conflict/file');
        const parent = path.startsWith('id:')
          ? files.get(path.split('/')[0])
          : undefined;
        if (path.startsWith('id:') && !parent)
          return error(response, 'path/not_found');
        const actual = parent
          ? `${parent.path}/${path.split('/').slice(1).join('/')}`
          : path;
        file = {
          id: `id:created-${state.nextId++}`,
          name: actual.split('/').at(-1)!,
          path: actual,
          content: '',
          revision: 0,
        };
        files.set(file.id, file);
        state.creates++;
      }
      file.content = text;
      file.revision++;
      if (body.property_groups && !state.omitMarker)
        file.groups = body.property_groups as DropboxFile['groups'];
      state.writes++;
      await state.writeWait;
      if (state.loseWriteReply) {
        state.loseWriteReply = false;
        response.destroy();
        return;
      }
      const { '.tag': _tag, ...uploadMetadata } = metadata(file);
      return json(response, uploadMetadata);
    }
    return error(response, 'unknown_route', 404);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw Error('No fixture address');
  const base = `http://127.0.0.1:${address.port}`;
  const endpoints: DropboxEndpoints = {
    authorize: `${base}/authorize`,
    token: `${base}/token`,
    api: `${base}/2/`,
    content: `${base}/2/`,
  };
  return {
    files,
    state,
    endpoints,
    resolve,
    metadata,
    externalEdit(id: string, content: string) {
      const file = files.get(id);
      if (!file) throw Error('Unknown fixture file');
      file.content = content;
      file.revision++;
    },

    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
