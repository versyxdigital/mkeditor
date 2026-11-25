/** Local OAuth/Drive server for the Electron smoke run. Never used by the app. */
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');

async function createFixture() {
  const files = new Map();
  let nextId = 0;
  const state = {
    offline: false,
    saveWait: undefined,
    revoked: false,
    refreshes: 0,
    loseNextSave: false,
    saveWrites: 0,
  };
  const folderMime = 'application/vnd.google-apps.folder';
  const root = {
    id: 'root',
    name: 'My Drive',
    mimeType: folderMime,
    parents: [],
    version: 1,
    contentRevision: 1,
    content: '',
  };
  files.set('root', root);
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const metadata = (file) => ({
    ...file,
    version: String(file.version),
    headRevisionId: `content-${file.contentRevision}`,
    etag: `"etag-${file.version}"`,
    md5Checksum: createHash('md5').update(file.content).digest('hex'),
    modifiedTime: '2026-11-24T12:00:00Z',
    size: String(Buffer.byteLength(file.content)),
    capabilities: {
      canEdit: true,
      canModifyContent: true,
      canAddChildren: true,
    },
  });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (state.offline) return json(response, {}, 503);
      let body = '';
      for await (const chunk of request) body += chunk;
      if (url.pathname === '/authorize') {
        const callback = new URL(url.searchParams.get('redirect_uri'));
        if (callback.hostname !== '127.0.0.1') return json(response, {}, 400);
        callback.searchParams.set('code', 'smoke-code');
        callback.searchParams.set('state', url.searchParams.get('state'));
        response.writeHead(302, { Location: callback.toString() });
        response.end();
        return;
      }
      if (url.pathname === '/token') {
        if (state.revoked)
          return json(response, { error: 'invalid_grant' }, 400);
        if (new URLSearchParams(body).get('grant_type') === 'refresh_token')
          state.refreshes++;
        return json(response, {
          access_token: 'smoke-access',
          refresh_token: 'smoke-refresh',
          expires_in: 3600,
          scope:
            'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive',
        });
      }
      if (request.headers.authorization !== 'Bearer smoke-access')
        return json(response, {}, 401);
      if (url.pathname === '/drive/v3/about')
        return json(response, {
          user: {
            permissionId: 'smoke-account',
            emailAddress: 'smoke@example.test',
          },
        });
      if (url.pathname.endsWith('/generateIds'))
        return json(response, { ids: [`smoke-${++nextId}`] });
      if (url.pathname === '/drive/v3/drives')
        return json(response, { drives: [] });
      const upload = url.pathname.startsWith('/upload/');
      if (request.method === 'POST' || request.method === 'PUT') {
        let data,
          content = '';
        if (upload) {
          const parts = body.split('\r\n\r\n');
          data = JSON.parse(parts[1].split('\r\n--')[0]);
          content = parts
            .slice(2)
            .join('\r\n\r\n')
            .replace(/\r\n--[^\r\n]+--\r\n$/, '');
        } else data = JSON.parse(body);
        if (request.method === 'POST') {
          if (files.has(data.id)) return json(response, {}, 409);
          const file = { ...data, content, version: 1, contentRevision: 1 };
          files.set(file.id, file);
          return json(response, metadata(file));
        }
        const file = files.get(
          decodeURIComponent(url.pathname.split('/').pop()),
        );
        if (!file) return json(response, {}, 404);
        if (request.headers['if-match'] !== `"etag-${file.version}"`)
          return json(response, {}, 412);
        file.content = content;
        state.saveWrites++;
        file.version++;
        file.contentRevision++;
        await state.saveWait;
        if (state.loseNextSave) {
          state.loseNextSave = false;
          response.destroy();
          return;
        }
        return json(response, metadata(file));
      }
      const id = decodeURIComponent(url.pathname.split('/').pop());
      if (request.method === 'PATCH') {
        const file = files.get(id);
        if (!file) return json(response, {}, 404);
        if (request.headers['if-match'] !== `"etag-${file.version}"`)
          return json(response, {}, 412);
        file.parents = file.parents.filter(
          (parent) => parent !== url.searchParams.get('removeParents'),
        );
        file.parents.push(url.searchParams.get('addParents'));
        file.version++;
        return json(response, metadata(file));
      }
      if (url.pathname === '/drive/v3/files') {
        const query = url.searchParams.get('q') ?? '';
        const unescape = (value) => value.replace(/\\(.)/g, '$1');
        const parent = query.match(/'((?:\\.|[^'])*)' in parents/);
        const name = query.match(/and name = '((?:\\.|[^'])*)'/);
        const entries = [...files.values()].filter(
          (file) =>
            file.parents.includes(parent ? unescape(parent[1]) : 'root') &&
            (!name || file.name === unescape(name[1])),
        );
        entries.sort(
          (a, b) =>
            Number(b.mimeType === folderMime) -
              Number(a.mimeType === folderMime) || a.name.localeCompare(b.name),
        );
        return json(response, { files: entries.map(metadata) });
      }
      const file = files.get(id);
      if (!file) return json(response, {}, 404);
      if (url.searchParams.get('alt') === 'media') {
        response.end(file.content);
        return;
      }
      return json(response, metadata(file));
    } catch {
      if (!response.headersSent) json(response, {}, 500);
      else response.destroy();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    externalEdit(id, content) {
      const file = files.get(id);
      if (!file || id === 'root')
        throw Error('Unknown disposable fixture file.');
      file.content = content;
      file.version++;
      file.contentRevision++;
    },
    state,
    endpoints: {
      authorize: `${base}/authorize`,
      token: `${base}/token`,
      api: `${base}/drive/v3/`,
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

module.exports = { createFixture };
