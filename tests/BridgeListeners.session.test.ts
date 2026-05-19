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
// `envelope.session.assistant` block into the assistant-UI seam.
// (The seam moved out of `react/` so manager code stays
// React-free — see `src/browser/assistantUiState.ts`.)
jest.mock('../src/browser/assistantUiState', () => ({
  applyRestoredAssistantState: jest.fn(),
}));

import { sonnerToast } from '../src/browser/notify';
import { applyRestoredAssistantState } from '../src/browser/assistantUiState';
import { registerBridgeListeners } from '../src/browser/core/BridgeListeners';
import type { SessionRestoreEnvelope } from '../src/browser/interfaces/Session';
import type {
  ChatDoneEvent,
  ChatErrorEvent,
  ChatToolCallEvent,
  ConfigPushPayload,
  OllamaModelsEvent,
} from '../src/app/interfaces/Assistant';

type Handler = (...args: unknown[]) => void;

describe('BridgeListeners session handlers', () => {
  let handlers: Record<string, Handler>;
  let bridge: { send: jest.Mock; receive: jest.Mock };
  // Minimal AssistantManager surface BridgeListeners exercises in P3.
  // Returned via the `manager` arg as `manager.assistantManager`.
  let assistantManager: {
    setConfigFromServer: jest.Mock;
    onOllamaModels: jest.Mock;
    onChatDone: jest.Mock;
    onChatError: jest.Mock;
    ownsCallId: jest.Mock;
    appendChunk: jest.Mock;
    onToolCall: jest.Mock;
    restore: jest.Mock;
    flushPersist: jest.Mock;
  };
  let manager: {
    setWindowState: jest.Mock;
    assistantManager: typeof assistantManager;
  };
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

    assistantManager = {
      setConfigFromServer: jest.fn(),
      onOllamaModels: jest.fn(),
      onChatDone: jest.fn(),
      onChatError: jest.fn(),
      ownsCallId: jest.fn(() => true),
      appendChunk: jest.fn(),
      onToolCall: jest.fn(),
      restore: jest.fn(),
      flushPersist: jest.fn(),
    };
    manager = {
      setWindowState: jest.fn(),
      assistantManager,
    };

    registerBridgeListeners(
      bridge as never,
      mkeditor as never,
      dispatcher as never,
      providers as never,
      files as never,
      tree as never,
      manager as never,
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

  // ----- AI Assistant P3 forwarding ---------------------------------

  it('from:ai:config delegates to assistantManager.setConfigFromServer with the exact payload', () => {
    const payload: ConfigPushPayload = {
      config: {
        anthropic: {
          enabled: true,
          hasKey: true,
          defaultModel: 'claude-sonnet-4-6',
        },
        openai: {
          enabled: false,
          hasKey: false,
          defaultModel: 'gpt-5',
        },
        ollama: {
          enabled: true,
          hasKey: false,
          baseUrl: 'http://localhost:11434',
          defaultModel: 'llama3.2',
        },
      },
      encryptionAvailable: true,
    };
    handlers['from:ai:config'](payload);
    expect(assistantManager.setConfigFromServer).toHaveBeenCalledTimes(1);
    expect(assistantManager.setConfigFromServer).toHaveBeenCalledWith(payload);
  });

  it('from:ai:ollama:models delegates to assistantManager.onOllamaModels with the exact payload', () => {
    const payload: OllamaModelsEvent = {
      callId: 'oll-1',
      models: ['llama3.2', 'qwen2.5'],
    };
    handlers['from:ai:ollama:models'](payload);
    expect(assistantManager.onOllamaModels).toHaveBeenCalledTimes(1);
    expect(assistantManager.onOllamaModels).toHaveBeenCalledWith(payload);
  });

  it('from:ai:done routes to onChatDone unconditionally (P4: manager partitions test vs chat internally)', () => {
    const payload: ChatDoneEvent = { callId: 'test-abc', finishReason: 'stop' };
    handlers['from:ai:done'](payload);
    expect(assistantManager.onChatDone).toHaveBeenCalledWith('test-abc');

    assistantManager.onChatDone.mockClear();
    handlers['from:ai:done']({ callId: 'chat-from-p4' });
    expect(assistantManager.onChatDone).toHaveBeenCalledWith('chat-from-p4');
  });

  it('from:ai:error routes to onChatError unconditionally (P4: manager partitions internally)', () => {
    const payload: ChatErrorEvent = {
      callId: 'test-abc',
      code: 'invalid_key',
      message: '401',
    };
    handlers['from:ai:error'](payload);
    expect(assistantManager.onChatError).toHaveBeenCalledWith(payload);

    assistantManager.onChatError.mockClear();
    const chatPayload: ChatErrorEvent = {
      callId: 'chat-from-p4',
      code: 'unknown',
      message: 'foo',
    };
    handlers['from:ai:error'](chatPayload);
    expect(assistantManager.onChatError).toHaveBeenCalledWith(chatPayload);
  });

  it('from:ai:chunk routes to appendChunk with the callId and text (P4)', () => {
    const appendChunk = jest.fn();
    assistantManager.appendChunk = appendChunk;
    handlers['from:ai:chunk']({ callId: 'chat-x', text: 'Hello' });
    expect(appendChunk).toHaveBeenCalledWith('chat-x', 'Hello');
  });

  // ----- AI Assistant P5 forwarding ---------------------------------

  it('from:ai:tool-call delegates to assistantManager.onToolCall with the exact payload (P5)', () => {
    const payload: ChatToolCallEvent = {
      callId: 'chat-x',
      toolCallId: 'tc-1',
      toolName: 'read_file',
      arguments: { path: '/a.md' },
    };
    handlers['from:ai:tool-call'](payload);
    expect(assistantManager.onToolCall).toHaveBeenCalledTimes(1);
    expect(assistantManager.onToolCall).toHaveBeenCalledWith(payload);
  });

  // ----- AI Assistant P7 forwarding ---------------------------------

  it('from:ai:conversations delegates the persisted-snapshot payload to assistantManager.restore (P7 boot hydration)', () => {
    const restore = jest.fn();
    assistantManager.restore = restore;
    const payload = {
      activeProvider: 'anthropic' as const,
      activeConversation: { anthropic: 'c-1', openai: null, ollama: null },
      conversations: { anthropic: [], openai: [], ollama: [] },
      drafts: {},
    };
    handlers['from:ai:conversations'](payload);
    expect(restore).toHaveBeenCalledWith(payload);
  });

  it('from:ai:conversations with null payload triggers restore(null) (P7 migration path for pre-P7 files)', () => {
    const restore = jest.fn();
    assistantManager.restore = restore;
    handlers['from:ai:conversations'](null);
    expect(restore).toHaveBeenCalledWith(null);
  });

  it('from:ai:conversations:flush-request fires assistantManager.flushPersist (P7 quit-flush)', () => {
    const flushPersist = jest.fn();
    assistantManager.flushPersist = flushPersist;
    handlers['from:ai:conversations:flush-request']();
    expect(flushPersist).toHaveBeenCalledTimes(1);
  });
});
