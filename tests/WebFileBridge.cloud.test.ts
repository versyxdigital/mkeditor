import { WebFileBridge } from '../src/browser/core/WebFileBridge';
import type {
  SessionPayload,
  SessionRestoreEnvelope,
} from '../src/browser/interfaces/Session';
import { remoteDocumentPath } from '../src/app/interfaces/Cloud';
import { WebCloudRecoveryStore } from '../src/browser/core/cloud/WebCloudRecoveryStore';

jest.mock('../src/browser/core/HTMLExporter', () => ({
  HTMLExporter: { webExport: jest.fn(), pdfWebExport: jest.fn() },
}));

const document = {
  connectionId: 'connection',
  accountId: 'account',
  connectionName: 'Drive',
  item: {
    id: 'item',
    name: 'remote.md',
    kind: 'markdown' as const,
    parents: ['root'],
    validator: '"1"',
    editable: true,
  },
  content: 'remote draft',
};
const remotePath = remoteDocumentPath(document);
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const bridges: WebFileBridge[] = [];
let grantOwnership: boolean;

function payload(
  path: string,
  content: string,
  includeRemote = true,
): SessionPayload {
  return {
    version: 3,
    workspaceRoot: null,
    activeFile: includeRemote ? remotePath : path,
    tabs: [
      { path, name: path, viewState: null, untitledContent: content },
      ...(includeRemote
        ? [
            {
              path: remotePath,
              name: 'remote.md',
              viewState: null,
              remote: { document, dirty: true, baseline: 'remote baseline' },
            },
          ]
        : []),
    ],
  };
}

async function openBridge() {
  const bridge = new WebFileBridge();
  bridges.push(bridge);
  let restored: SessionRestoreEnvelope | undefined;
  bridge.receive('from:session:restore', (value: SessionRestoreEnvelope) => {
    restored = value;
  });
  await bridge.bootstrap();
  return { bridge, restored: restored! };
}

beforeEach(() => {
  localStorage.clear();
  grantOwnership = true;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (
        _name: string,
        _options: unknown,
        callback: (lock: unknown) => unknown,
      ) => Promise.resolve(callback(grantOwnership ? { name: 'cloud' } : null)),
    },
  });
});

afterEach(() => {
  bridges.splice(0).forEach((bridge) => bridge.dispose());
  jest.restoreAllMocks();
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

test('legacy text migration preserves existing remote drafts before writing its replacement checkpoint', async () => {
  const recovery = new WebCloudRecoveryStore(localStorage);
  const saved = payload('untitled-1', 'unused');
  saved.tabs = saved.tabs.filter((tab) => tab.remote);
  recovery.saveSessionSync(saved);
  localStorage.setItem('mkeditor-content', 'legacy draft');
  const { restored } = await openBridge();
  expect(restored.session?.tabs.map((tab) => tab.path)).toEqual([
    'untitled-1',
    remotePath,
  ]);
  expect(restored.session?.tabs[0].untitledContent).toBe('legacy draft');
  expect(restored.session?.tabs[1].remote?.document.content).toBe(
    'remote draft',
  );
  expect(recovery.loadSync().session).toMatchObject({
    tabs: [{ untitledContent: 'legacy draft' }, { remote: { document } }],
  });
  expect(localStorage.getItem('mkeditor-content')).toBeNull();
});

test('a failed local commit recovers the newer full cloud checkpoint and its local draft', async () => {
  const first = await openBridge();
  first.bridge.send('to:session:save', payload('untitled-1', 'before'));
  const previousLocal = localStorage.getItem('mkeditor-session');
  const acknowledgements: { ok: boolean }[] = [];
  first.bridge.receive('from:session:saved', (value: { ok: boolean }) =>
    acknowledgements.push(value),
  );
  const originalSet = Storage.prototype.setItem;
  const write = jest
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(function (this: Storage, key, value) {
      if (key === 'mkeditor-session') throw new Error('quota');
      originalSet.call(this, key, value);
    });
  first.bridge.send(
    'to:session:save',
    payload('untitled-1', 'after local commit failure'),
  );
  expect(acknowledgements).toEqual([{ ok: false }]);
  expect(localStorage.getItem('mkeditor-session')).toBe(previousLocal);
  write.mockRestore();
  first.bridge.dispose();
  const next = await openBridge();
  expect(next.restored.session?.tabs[0].untitledContent).toBe(
    'after local commit failure',
  );
  expect(next.restored.session?.tabs[1].remote?.document.content).toBe(
    'remote draft',
  );
});

test('an independent local checkpoint replaces stale local tabs without dropping the recovered cloud draft', async () => {
  const owner = await openBridge();
  owner.bridge.send(
    'to:session:save',
    payload('untitled-1', 'stale local draft'),
  );
  const remoteCheckpoint = localStorage.getItem('mkeditor-cloud-recovery');
  grantOwnership = false;
  const localOnly = await openBridge();
  localOnly.bridge.send(
    'to:session:save',
    payload('untitled-2', 'new local draft', false),
  );
  expect(localStorage.getItem('mkeditor-cloud-recovery')).toBe(
    remoteCheckpoint,
  );
  owner.bridge.dispose();
  localOnly.bridge.dispose();
  grantOwnership = true;
  const next = await openBridge();
  expect(next.restored.session?.tabs.map((tab) => tab.path)).toEqual([
    'untitled-2',
    remotePath,
  ]);
  expect(next.restored.session?.tabs[0].untitledContent).toBe(
    'new local draft',
  );
  expect(next.restored.session?.tabs[1].remote?.document.content).toBe(
    'remote draft',
  );
});
