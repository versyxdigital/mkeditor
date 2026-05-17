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

import { sonnerToast } from '../src/browser/notify';
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
    activeFile: string | null;
    activateFile: jest.Mock;
    addTab: jest.Mock;
    renameTab: jest.Mock;
    replaceUntitled: jest.Mock;
  };

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
      activeFile: null,
      activateFile: jest.fn(),
      addTab: jest.fn(),
      renameTab: jest.fn(),
      replaceUntitled: jest.fn(),
    };

    const tree = {
      openingFolder: false,
      treeRoot: null,
      buildFileTree: jest.fn(),
      addFileToTree: jest.fn(),
    };
    const mkeditor = {
      getValue: jest.fn(() => ''),
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
