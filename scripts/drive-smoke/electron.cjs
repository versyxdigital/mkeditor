/** Isolated shell around the production renderer, cloud service and encrypted store. */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { CloudService } = require('../../dist/app/lib/cloud/CloudService');
const { CloudStore } = require('../../dist/app/lib/cloud/CloudStore');
const { GoogleDrive } = require('../../dist/app/lib/cloud/GoogleDrive');

const option = process.argv.find((value) =>
  value.startsWith('--mkeditor-smoke='),
);
if (!option) {
  console.error('Launch this shell through npm run test:drive-smoke.');
  app.exit(1);
}
const options = JSON.parse(
  Buffer.from(option.slice('--mkeditor-smoke='.length), 'base64').toString(
    'utf8',
  ),
);
// Playwright adds browser-testing keychain switches; this check requires real OS encryption.
app.commandLine.removeSwitch('password-store');
app.commandLine.removeSwitch('use-mock-keychain');
const outputRoot = path.resolve(__dirname, '../../out/drive-smoke');
const profile = path.resolve(options.profile);
if (!profile.startsWith(outputRoot + path.sep))
  throw Error('Smoke profile must be inside out/drive-smoke.');
if (options.live && !options.authorize)
  throw Error('Live tests require explicit authorization.');
if (
  !options.live &&
  Object.values(options.endpoints ?? {}).some(
    (value) => new URL(value).hostname !== '127.0.0.1',
  )
)
  throw Error('Fixture endpoints must be loopback-only.');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', path.join(profile, 'electron'));
app.disableHardwareAcceleration();
const scopeFile = path.join(profile, 'scope.json');
const scope = fs.existsSync(scopeFile)
  ? JSON.parse(fs.readFileSync(scopeFile, 'utf8'))
  : { folders: [], documents: [], rootId: null, rootName: options.rootName };
const persistScope = () =>
  fs.writeFileSync(scopeFile, JSON.stringify(scope, null, 2));
let win, service;
const store = new CloudStore(path.join(profile, 'connections.json'));
const drive = options.live
  ? new GoogleDrive()
  : new GoogleDrive(options.endpoints);
let requestId = 0;
const execute = (command) =>
  service.handle({ requestId: `smoke-control-${++requestId}`, command });
const assertDocument = (id) => {
  if (!scope.documents.includes(id))
    throw Error("Only this run's disposable documents may be changed.");
};
function permitted(command) {
  if (command.action === 'create' || command.action === 'createFolder')
    return scope.folders.includes(command.folderId);
  if (command.action === 'save')
    return scope.documents.includes(command.itemId);
  if (command.action === 'move')
    return (
      scope.documents.includes(command.itemId) &&
      scope.folders.includes(command.folderId) &&
      scope.folders.includes(command.sourceFolderId)
    );
  return true;
}
function remember(command, result) {
  if (!result.ok) return;
  if (command.action === 'create' && result.document)
    scope.documents.push(result.document.item.id);
  if (command.action === 'createFolder' && result.item)
    scope.folders.push(result.item.id);
  persistScope();
}
async function access() {
  const entry = store
    .load()
    .find((entry) => entry.status === 'connected' && entry.credential);
  if (!entry) throw Error('No connected smoke account.');
  const tokens = await store.decrypt(entry.credential);
  return tokens.access;
}

app
  .whenReady()
  .then(async () => {
    service = new CloudService(
      store,
      async (url) => {
        if (options.live) await shell.openExternal(url);
        else {
          const response = await fetch(url);
          if (!response.ok) throw Error('Fixture callback failed.');
        }
      },
      (state) => win?.webContents.send('from:cloud:state', state),
      drive,
      options.live
        ? undefined
        : {
            clientId: 'smoke.apps.googleusercontent.com',
            clientValue: 'smoke-public-value',
          },
    );
    for (const [channel, value] of [
      ['mked:get-locale', 'en'],
      ['mked:get-active-file', null],
      ['mked:secure:public-key', ''],
    ])
      ipcMain.on(channel, (event) => {
        event.returnValue = value;
      });
    ipcMain.handle('mked:path:dirname', (_event, value) => path.dirname(value));
    ipcMain.on('to:cloud:request', async (event, request) => {
      if (event.sender !== win.webContents) return;
      const command = request.command;
      const result = permitted(command)
        ? await service.handle(request)
        : { requestId: request.requestId, ok: false, error: 'permission' };
      remember(command, result);
      if (!event.sender.isDestroyed())
        event.sender.send('from:cloud:result', result);
    });
    globalThis.driveSmoke = {
      state: () => service.state(),
      scope: () => ({ ...scope }),
      async prepareRoot() {
        if (scope.rootId) return { ...scope };
        const state = await service.state();
        const entry = state.connections.find(
          (entry) => entry.status === 'connected' && entry.writeAccess,
        );
        if (!entry)
          throw Error('Enable editing before preparing a disposable folder.');
        const result = await execute({
          action: 'createFolder',
          connectionId: entry.id,
          accountId: entry.accountId,
          folderId: 'root',
          name: scope.rootName,
          operationId: `smoke-root-${Date.now()}`,
        });
        if (!result.ok || !result.item)
          throw Error('Disposable root creation failed.');
        scope.rootId = result.item.id;
        scope.folders.push(result.item.id);
        persistScope();
        return { ...scope };
      },
      async expireCredentials() {
        const entries = store.load();
        for (const entry of entries)
          if (entry.credential) {
            const tokens = await store.decrypt(entry.credential);
            entry.credential = await store.encrypt({ ...tokens, expires: 0 });
          }
        store.save(entries);
      },
      async verifyContent(id, expected) {
        assertDocument(id);
        const document = await drive.read(await access(), id, true);
        if (
          document.content.replace(/\r\n/g, '\n') !==
          expected.replace(/\r\n/g, '\n')
        )
          throw Error(
            'Independent Drive read did not match expected contents.',
          );
        return true;
      },
      async externalEdit(id, content) {
        assertDocument(id);
        const token = await access();
        const document = await drive.read(token, id, true);
        await drive.update(
          token,
          id,
          document.item.validator,
          content,
          () => {},
        );
      },
    };
    win = new BrowserWindow({
      show: Boolean(options.live || options.headed),
      frame: false,
      width: 1280,
      height: 900,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.resolve(__dirname, '../../dist/app/preload.js'),
      },
    });
    await win.loadFile(path.resolve(__dirname, '../../dist/index.html'));
  })
  .catch(() => {
    console.error('Drive smoke shell failed to initialize.');
    app.exit(1);
  });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => service?.dispose());
