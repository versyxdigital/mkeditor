/** @jest-environment node */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { SessionPayload } from '../src/app/interfaces/Session';
import type { RemoteDocument } from '../src/app/interfaces/Cloud';
import type { RecoveryOperation } from '../src/app/lib/cloud/CloudRecoveryStore';

let root: string;
let Store: typeof import('../src/app/lib/cloud/CloudRecoveryStore').CloudRecoveryStore;
let Coordinator: typeof import('../src/app/lib/cloud/CloudSessionRecovery').CloudSessionRecovery;
let Session: typeof import('../src/app/lib/AppSession').AppSession;
let storage: typeof import('electron').safeStorage;
const document: RemoteDocument = {
  connectionId: 'drive',
  accountId: 'account',
  connectionName: 'Drive',
  item: {
    id: 'item',
    name: 'notes.md',
    kind: 'markdown',
    parents: ['root'],
    validator: '"baseline"',
    editable: true,
  },
  content: 'private draft',
};
const identity = 'cloud-drive://drive/account/item';
const session = (content = document.content, sequence = 3): SessionPayload => ({
  version: 3,
  workspaceRoot: null,
  activeFile: identity,
  tabs: [
    {
      path: identity,
      name: 'notes.md',
      viewState: { cursorState: [] },
      remote: {
        document: { ...document, content },
        baseline: 'saved baseline',
        dirty: true,
        epoch: 'epoch',
        sequence,
      },
    },
  ],
});
const operation: RecoveryOperation = {
  operationId: 'interrupted',
  connectionId: 'drive',
  accountId: 'account',
  itemId: 'item',
  kind: 'save',
  content: 'write snapshot',
  validator: '"baseline"',
  epoch: 'epoch',
  sequence: 2,
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mkeditor-recovery-'));
  jest.resetModules();
  jest.doMock('os', () => ({
    ...jest.requireActual('os'),
    homedir: () => root,
  }));
  Store = require('../src/app/lib/cloud/CloudRecoveryStore').CloudRecoveryStore;
  Coordinator =
    require('../src/app/lib/cloud/CloudSessionRecovery').CloudSessionRecovery;
  Session = require('../src/app/lib/AppSession').AppSession;
  storage = require('electron').safeStorage;
  const key = randomBytes(32);
  jest.mocked(storage.encryptStringAsync).mockImplementation(async (value) => {
    const iv = randomBytes(16),
      cipher = createCipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final()]);
  });
  jest
    .mocked(storage.decryptStringAsync)
    .mockImplementation(async (encrypted) => {
      const decipher = createDecipheriv(
        'aes-256-cbc',
        key,
        encrypted.subarray(0, 16),
      );
      return {
        result: Buffer.concat([
          decipher.update(encrypted.subarray(16)),
          decipher.final(),
        ]).toString('utf8'),
        shouldReEncrypt: false,
      };
    });
});
afterEach(() => {
  jest.dontMock('os');
  rmSync(root, { recursive: true, force: true });
});

test('remote drafts are encrypted and never enter the plaintext session or filesystem validation', async () => {
  const file = join(root, 'recovery.bin');
  const recovery = new Coordinator(new Store(file));
  await recovery.save(session());
  expect(readFileSync(file).includes(Buffer.from('private draft'))).toBe(false);
  const plain = readFileSync(join(root, '.mkeditor', 'session.json'), 'utf8');
  expect(plain).not.toMatch(/private draft|saved baseline|cloud-drive/);
  const restored = await new Coordinator(new Store(file)).restore(
    Session.load(),
  );
  expect(restored.missing).toEqual([]);
  expect(restored.session?.tabs[0].remote).toMatchObject({
    document,
    baseline: 'saved baseline',
    dirty: true,
  });
  expect(restored.session?.activeFile).toBe(identity);
});

test('a failed checkpoint preserves the last committed generation', async () => {
  const file = join(root, 'recovery.bin');
  const recovery = new Coordinator(new Store(file));
  await recovery.save(session('committed draft'));
  jest
    .mocked(storage.encryptStringAsync)
    .mockRejectedValueOnce(new Error('locked'));
  await expect(recovery.save(session('not committed'))).rejects.toMatchObject({
    code: 'storage',
  });
  const restored = await new Coordinator(new Store(file)).restore(
    Session.load(),
  );
  expect(restored.session?.tabs[0].remote?.document.content).toBe(
    'committed draft',
  );
});

test('corrupt recovery data is reported and is not replaced by a fresh empty session', async () => {
  const file = join(root, 'recovery.bin');
  writeFileSync(file, 'corrupt data');
  const recovery = new Coordinator(new Store(file));
  expect((await recovery.restore(null)).recoveryError).toBe(true);
  await expect(recovery.save(session())).rejects.toMatchObject({
    code: 'storage',
  });
  expect(readFileSync(file, 'utf8')).toBe('corrupt data');
});

test('an interrupted write newer than the last checkpoint supplies the latest recoverable text', async () => {
  const file = join(root, 'recovery.bin'),
    store = new Store(file);
  await store.saveSession(session('older draft', 1));
  await store.saveOperations([operation]);
  const restored = await new Coordinator(new Store(file)).restore(null);
  expect(restored.session?.tabs[0].remote).toMatchObject({
    document: { content: 'write snapshot' },
    pendingSave: { operationId: 'interrupted' },
  });
});

test('edits checkpointed after an interrupted write are retained', async () => {
  const file = join(root, 'recovery.bin'),
    store = new Store(file);
  await store.saveOperations([operation]);
  await store.saveSession(session('newer edits', 3));
  const restored = await new Coordinator(new Store(file)).restore(null);
  expect(restored.session?.tabs[0].remote?.document.content).toBe(
    'newer edits',
  );
  expect(restored.session?.tabs[0].remote?.pendingSave?.content).toBe(
    'write snapshot',
  );
});

test('a create interrupted before its first tab checkpoint restores a recoverable draft', async () => {
  const file = join(root, 'recovery.bin'),
    store = new Store(file);
  await store.saveOperations([
    { ...operation, kind: 'create', folderId: 'root', name: 'Copy.md' },
  ]);
  const restored = await new Coordinator(new Store(file)).restore(null);
  expect(restored.session?.tabs[0]).toMatchObject({
    path: identity,
    name: 'Copy.md',
    remote: { document: { content: 'write snapshot' }, dirty: true },
  });
});

test('clearing a saved session removes drafts but keeps the write journal without resurrecting tabs', async () => {
  const file = join(root, 'recovery.bin'),
    store = new Store(file);
  const recovery = new Coordinator(store);
  await recovery.save(session());
  await store.saveOperations([operation]);
  await recovery.clear();
  const next = new Store(file);
  expect((await next.load()).operations).toHaveLength(1);
  expect(
    (await new Coordinator(next).restore(Session.load())).session,
  ).toBeNull();
});

test('session snapshots cannot acknowledge an unresolved operation', async () => {
  const store = new Store(join(root, 'recovery.bin'));
  await store.saveOperations([operation]);
  await store.saveSession(session(), ['interrupted']);
  expect((await store.load()).operations).toHaveLength(1);
  await expect(store.acknowledge('interrupted')).rejects.toMatchObject({
    code: 'unconfirmed',
  });
});

test('queued journal and draft updates preserve both pieces of recovery state', async () => {
  const store = new Store(join(root, 'recovery.bin'));
  await Promise.all([
    store.saveSession(session()),
    store.saveOperations([operation]),
  ]);
  const saved = await store.load();
  expect(saved.session).toBeDefined();
  expect(saved.operations).toHaveLength(1);
});

test('a cleared session rejects stale quit checkpoints and resumes only after new activity', async () => {
  const store = new Store(join(root, 'recovery.bin')),
    recovery = new Coordinator(store);
  await recovery.save(session());
  const token = await recovery.clear();
  await recovery.save(session('stale queued text'));
  expect((await store.load()).session).toBeUndefined();
  await recovery.save({ ...session('new activity'), resumeAfterClear: token });
  const restored = await recovery.restore(Session.load());
  expect(restored.session?.tabs[0].remote?.document.content).toBe(
    'new activity',
  );
});

test('the plaintext session writer rejects remote text even when called directly', async () => {
  expect(Session.save(session())).toBe(false);
  expect(Session.load()).toBeNull();
});

test('journal writers merge independent intentions without losing an acknowledgement', async () => {
  const store = new Store(join(root, 'recovery.bin'));
  const acknowledged = {
    ...operation,
    document: { ...document, content: operation.content! },
  };
  await store.saveOperations([acknowledged]);
  await store.saveOperations([
    { ...operation, document: undefined },
    { ...operation, operationId: 'second', itemId: 'second' },
  ]);
  const operations = (await store.load()).operations;
  expect(operations).toHaveLength(2);
  expect(operations[0].document?.content).toBe(operation.content);
});

test('disabling restoration leaves the previous encrypted snapshot untouched', async () => {
  const store = new Store(join(root, 'recovery.bin')),
    recovery = new Coordinator(store);
  await recovery.save(session('kept checkpoint'));
  await recovery.save({
    ...session('disabled changes'),
    restoreEnabled: false,
  });
  expect(
    (await recovery.restore(Session.load())).session?.tabs[0].remote?.document
      .content,
  ).toBe('kept checkpoint');
});

test('a compact journal acknowledgement restores the complete saved contents', async () => {
  const file = join(root, 'recovery.bin');
  const content = 'private snapshot repeated '.repeat(1000);
  await new Store(file).saveOperations([
    { ...operation, content, document: { ...document, content } },
  ]);
  const restored = (await new Store(file).load()).operations[0];
  expect(restored.content).toBe(content);
  expect(restored.document?.content).toBe(content);
});

test('failed local session removal is reported and does not lock out later checkpoints', async () => {
  const store = new Store(join(root, 'recovery.bin'));
  const recovery = new Coordinator(store, {
    save: jest.fn(() => true),
    clear: jest.fn(() => false),
  });
  await recovery.save(session());
  await expect(recovery.clear()).rejects.toMatchObject({ code: 'storage' });
  await recovery.save(session('writing after failed clear'));
  expect(
    (await recovery.restore(null)).session?.tabs[0].remote?.document.content,
  ).toBe('writing after failed clear');
});

test('clearing suppresses old intentions while later work still recovers before its first tab checkpoint', async () => {
  const file = join(root, 'recovery.bin');
  const store = new Store(file);
  const recovery = new Coordinator(store);
  await store.saveOperations([operation]);
  const token = await recovery.clear();
  await store.saveOperations([
    {
      ...operation,
      operationId: 'new-work',
      itemId: 'new-item',
      content: 'new recoverable writing',
    },
  ]);
  await recovery.save({
    version: 3,
    tabs: [],
    activeFile: null,
    workspaceRoot: null,
    resumeAfterClear: token,
  });
  const restored = await new Coordinator(new Store(file)).restore(null);
  expect(restored.session?.tabs).toHaveLength(1);
  expect(restored.session?.tabs[0].remote).toMatchObject({
    document: { item: { id: 'new-item' }, content: 'new recoverable writing' },
    pendingSave: { operationId: 'new-work' },
  });
});
