/**
 * Tests for the session-related handlers wired up by
 * `registerBridgeListeners`. Covers the renderer side of the
 * `from:session:restore` and `from:session:flush-request` channels —
 * the toast-on-missing-files branch in particular, which the
 * FileManager-level tests don't reach.
 */

jest.mock('../src/browser/notify', () => ({
  sonnerToast: jest.fn(),
}));

jest.mock('../src/browser/i18n', () => ({
  t: jest.fn((key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  ),
  whenLanguageReady: jest.fn(() => Promise.resolve()),
}));

// Modal/properties context seams used by other BridgeListeners
// handlers — stub so the registration doesn't pull React in.
jest.mock('../src/browser/react/contexts/ModalsContext', () => ({
  openModalExternal: jest.fn(),
}));

jest.mock('../src/browser/react/contexts/PropertiesContext', () => ({
  showPropertiesExternal: jest.fn(),
}));

// AI Assistant P2: BridgeListeners forwards the restored
// `envelope.session.assistant` block into UIStateContext via this seam.
// Mocked so the test runs without pulling React in.
jest.mock('../src/browser/react/contexts/UIStateContext', () => ({
  applyRestoredAssistantState: jest.fn(),
}));

import { sonnerToast } from '../src/browser/notify';
import { applyRestoredAssistantState } from '../src/browser/react/contexts/UIStateContext';
import { registerBridgeListeners } from '../src/browser/core/BridgeListeners';
import type { SessionRestoreEnvelope } from '../src/browser/interfaces/Session';

type Handler = (...args: unknown[]) => void;

describe('BridgeListeners session handlers', () => {
  let handlers: Record<string, Handler>;
  let bridge: { send: jest.Mock; receive: jest.Mock };
  let files: {
    restoreSession: jest.Mock;
    serializeSession: jest.Mock;
    openingFile: boolean;
    untitledCounter: number;
    models: Map<string, unknown>;
    tabs: Map<string, unknown>;
    activeFile: string | null;
    activateFile: jest.Mock;
    addTab: jest.Mock;
    renameTab: jest.Mock;
    replaceUntitled: jest.Mock;
    seedUntitled: jest.Mock;
  };
  let mkeditor: { getValue: jest.Mock } & Record<string, jest.Mock>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = {};
    bridge = {
      send: jest.fn(),
      receive: jest.fn((channel: string, fn: Handler) => {
        handlers[channel] = fn;
      }),
    };
    files = {
      restoreSession: jest.fn(),
      serializeSession: jest.fn(() => ({
        version: 1 as const,
        tabs: [],
        activeFile: null,
        workspaceRoot: null,
      })),
      openingFile: false,
      untitledCounter: 1,
      models: new Map(),
      tabs: new Map(),
      activeFile: null,
      activateFile: jest.fn(),
      addTab: jest.fn(),
      renameTab: jest.fn(),
      replaceUntitled: jest.fn(),
      seedUntitled: jest.fn(),
    };

    const tree = {
      openingFolder: false,
      treeRoot: null,
      buildFileTree: jest.fn(),
      addFileToTree: jest.fn(),
    };
    mkeditor = {
      getValue: jest.fn(() => 'welcome-markdown-content'),
      updateOptions: jest.fn(),
      setModel: jest.fn(),
      focus: jest.fn(),
      trigger: jest.fn(),
    };
    const dispatcher = {
      render: jest.fn(),
      setTrackedContent: jest.fn(),
    };
    const providers = {
      settings: null,
      exportSettings: null,
      commands: null,
      completion: null,
    };

    registerBridgeListeners(
      bridge as never,
      mkeditor as never,
      dispatcher as never,
      providers as never,
      files as never,
      tree as never,
    );
  });

  it('from:session:restore calls FileManager.restoreSession with the envelope', () => {
    const envelope: SessionRestoreEnvelope = {
      session: { version: 1, tabs: [], activeFile: null, workspaceRoot: null },
      missing: [],
      contents: {},
    };
    handlers['from:session:restore'](envelope);
    expect(files.restoreSession).toHaveBeenCalledWith(envelope);
  });

  it('from:session:restore forwards the assistant block to UIStateContext when present', () => {
    const envelope: SessionRestoreEnvelope = {
      session: {
        version: 2,
        tabs: [],
        activeFile: null,
        workspaceRoot: null,
        assistant: { sidebarOpen: true, size: 33.3 },
      },
      missing: [],
      contents: {},
    };
    handlers['from:session:restore'](envelope);
    expect(applyRestoredAssistantState).toHaveBeenCalledTimes(1);
    expect(applyRestoredAssistantState).toHaveBeenCalledWith({
      sidebarOpen: true,
      size: 33.3,
    });
  });

  it('from:session:restore skips the assistant seam when the block is absent (v1 payload)', () => {
    const envelope: SessionRestoreEnvelope = {
      session: { version: 1, tabs: [], activeFile: null, workspaceRoot: null },
      missing: [],
      contents: {},
    };
    handlers['from:session:restore'](envelope);
    expect(applyRestoredAssistantState).not.toHaveBeenCalled();
  });

  it('from:session:restore does not fire a toast when nothing is missing', () => {
    handlers['from:session:restore']({
      session: { version: 1, tabs: [], activeFile: null, workspaceRoot: null },
      missing: [],
      contents: {},
    });
    expect(sonnerToast).not.toHaveBeenCalled();
  });

  it('from:session:restore fires one missing-file toast when paths are missing', () => {
    const envelope: SessionRestoreEnvelope = {
      session: { version: 1, tabs: [], activeFile: null, workspaceRoot: null },
      missing: ['/abs/gone.md', '/abs/also-gone.md'],
      contents: {},
    };
    handlers['from:session:restore'](envelope);

    expect(sonnerToast).toHaveBeenCalledTimes(1);
    const [level, message] = (sonnerToast as jest.Mock).mock.calls[0];
    expect(level).toBe('warning');
    // The mocked `t` includes the values JSON, so we just check the
    // comma-joined paths landed inside it.
    expect(message).toContain('/abs/gone.md, /abs/also-gone.md');
    expect(message).toContain('session_file_missing');
  });

  it('from:session:restore still replays the session even when paths are missing', () => {
    const envelope: SessionRestoreEnvelope = {
      session: {
        version: 1,
        tabs: [{ path: '/abs/keep.md', name: 'keep.md', viewState: null }],
        activeFile: '/abs/keep.md',
        workspaceRoot: null,
      },
      missing: ['/abs/gone.md'],
      contents: { '/abs/keep.md': 'kept' },
    };
    handlers['from:session:restore'](envelope);
    expect(files.restoreSession).toHaveBeenCalledWith(envelope);
  });

  it('from:session:restore seeds an untitled tab when no tabs landed', () => {
    // restoreSession is a no-op against an empty envelope, so the
    // tabs map stays empty. The handler should fall back to a seed
    // using the current Monaco buffer (the welcome markdown).
    handlers['from:session:restore']({
      session: null,
      missing: [],
      contents: {},
    });
    expect(files.seedUntitled).toHaveBeenCalledTimes(1);
    expect(files.seedUntitled).toHaveBeenCalledWith('welcome-markdown-content');
  });

  it('from:session:restore does NOT seed when restoreSession produced tabs', () => {
    // Simulate restoreSession installing a tab — the handler must
    // not double-seed on top of it.
    files.restoreSession.mockImplementation(() => {
      files.tabs.set('/abs/keep.md', { path: '/abs/keep.md', name: 'keep.md' });
    });

    handlers['from:session:restore']({
      session: {
        version: 1,
        tabs: [{ path: '/abs/keep.md', name: 'keep.md', viewState: null }],
        activeFile: '/abs/keep.md',
        workspaceRoot: null,
      },
      missing: [],
      contents: { '/abs/keep.md': 'kept' },
    });

    expect(files.seedUntitled).not.toHaveBeenCalled();
  });

  it('from:session:flush-request ships a synchronous to:session:save', () => {
    handlers['from:session:flush-request']();
    expect(files.serializeSession).toHaveBeenCalledTimes(1);
    expect(bridge.send).toHaveBeenCalledWith('to:session:save', {
      version: 1,
      tabs: [],
      activeFile: null,
      workspaceRoot: null,
    });
  });

  it('from:session:restore re-opens the workspace via to:file:openpath when a root is persisted', () => {
    const envelope: SessionRestoreEnvelope = {
      session: {
        version: 1,
        tabs: [],
        activeFile: null,
        workspaceRoot: '/abs/my-notes',
      },
      missing: [],
      contents: {},
    };
    handlers['from:session:restore'](envelope);
    expect(bridge.send).toHaveBeenCalledWith('to:file:openpath', {
      path: '/abs/my-notes',
    });
  });

  it('from:session:restore does not fire to:file:openpath when no workspaceRoot is set', () => {
    handlers['from:session:restore']({
      session: { version: 1, tabs: [], activeFile: null, workspaceRoot: null },
      missing: [],
      contents: {},
    });
    expect(bridge.send).not.toHaveBeenCalled();
  });
});
