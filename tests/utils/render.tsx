import * as React from 'react';
import {
  render,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';

import {
  ManagersProvider,
  type Managers,
} from '../../src/browser/react/contexts/ManagersContext';
import { UIStateProvider } from '../../src/browser/react/contexts/UIStateContext';
import { FilesProvider } from '../../src/browser/react/contexts/FilesContext';
import { FileTreeProvider } from '../../src/browser/react/contexts/FileTreeContext';
import { ModalsProvider } from '../../src/browser/react/contexts/ModalsContext';
import { PromptsProvider } from '../../src/browser/react/contexts/PromptsContext';
import { PropertiesProvider } from '../../src/browser/react/contexts/PropertiesContext';
import { SettingsContextProvider } from '../../src/browser/react/contexts/SettingsContext';
import { ExportSettingsContextProvider } from '../../src/browser/react/contexts/ExportSettingsContext';
import { AssistantContextProvider } from '../../src/browser/react/contexts/AssistantContext';

/**
 * Minimal in-memory FileManager stub good enough to drive the React
 * components that subscribe to it. Tests can override individual methods
 * via the `managers` overrides in `renderWithProviders` and assert on the
 * jest mocks.
 */
export function fakeFileManager(
  init: {
    tabs?: { path: string; name: string }[];
    activeFile?: string | null;
  } = {},
) {
  let snapshot = {
    tabs: init.tabs ?? [],
    activeFile: init.activeFile ?? null,
  };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  return {
    activateFile: jest.fn((path: string) => {
      snapshot = { ...snapshot, activeFile: path };
      emit();
    }),
    closeTab: jest.fn(async (_path: string) => {}),
    reorderTabs: jest.fn(),
    openFileFromPath: jest.fn(),
    createUntitledTab: jest.fn(),
    on: jest.fn((event: 'change', listener: () => void) => {
      if (event !== 'change') throw new Error(`unsupported event ${event}`);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    getSnapshot: jest.fn(() => snapshot),
    _setSnapshot: (next: typeof snapshot) => {
      snapshot = next;
      emit();
    },
  };
}

/**
 * Stub the AssistantManager observable surface AssistantContext
 * expects. Defaults to "no config yet" (config: null) — the initial
 * loading state. Pass `initialSnapshot` to seed a hydrated state.
 *
 * Exposes `_setSnapshot` so tests can drive subsequent emits (e.g.
 * "user enables a provider" → snapshot update → sidebar re-renders).
 */
export function fakeAssistantManager(
  init: {
    initialSnapshot?: {
      config: {
        anthropic: { enabled: boolean; hasKey: boolean; defaultModel: string };
        openai: { enabled: boolean; hasKey: boolean; defaultModel: string };
        ollama: {
          enabled: boolean;
          hasKey: false;
          baseUrl: string;
          defaultModel: string;
        };
      } | null;
      encryptionAvailable: boolean;
    };
  } = {},
) {
  let snapshot =
    init.initialSnapshot ?? { config: null, encryptionAvailable: false };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    subscribeConfig: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    getConfigSnapshot: jest.fn(() => snapshot),
    setProviderConfig: jest.fn(),
    setKey: jest.fn(),
    clearKey: jest.fn(),
    refreshOllamaModels: jest.fn(async () => [] as string[]),
    testConnection: jest.fn(async () => ({ ok: true })),
    requestConfigRefresh: jest.fn(),
    setConfigFromServer: jest.fn(),
    onChatDone: jest.fn(),
    onChatError: jest.fn(),
    onOllamaModels: jest.fn(),
    ownsCallId: jest.fn(() => false),
    cancelChat: jest.fn(),
    _setSnapshot: (next: typeof snapshot) => {
      snapshot = next;
      emit();
    },
  };
}

/** Stub the FileTreeManager observable surface FileTreeContext expects. */
export function fakeFileTreeManager(
  init: {
    nodes?: unknown[];
    treeRoot?: string | null;
  } = {},
) {
  let snapshot = {
    nodes: init.nodes ?? [],
    treeRoot: init.treeRoot ?? null,
  };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  return {
    requestDirectoryContents: jest.fn(),
    on: jest.fn((event: 'change', listener: () => void) => {
      if (event !== 'change') throw new Error(`unsupported event ${event}`);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    getSnapshot: jest.fn(() => snapshot),
    _setSnapshot: (next: typeof snapshot) => {
      snapshot = next;
      emit();
    },
  };
}

/** Minimal EditorDispatcher that supports addEventListener / removeEventListener / dispatch. */
export function fakeDispatcher() {
  const target = new EventTarget();
  return {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    render: () => target.dispatchEvent(new CustomEvent('editor:render')),
    setTrackedContent: ({ content }: { content: string }) =>
      target.dispatchEvent(
        new CustomEvent('editor:track:content', { detail: content }),
      ),
    message: ({ detail }: { detail: string }) =>
      target.dispatchEvent(new CustomEvent('message', { detail })),
  };
}

/** Build a stubbed Managers object with sensible defaults; overrides win. */
export function buildManagers(overrides: Partial<Managers> = {}): Managers {
  const dispatcher = overrides.dispatcher ?? (fakeDispatcher() as any);
  return {
    mode: 'web',
    platform: 'web',
    dispatcher,
    editorManager: {
      getValue: jest.fn(() => ''),
      getMkEditor: jest.fn(() => null),
      layout: jest.fn(),
      resetContent: jest.fn(),
      providers: {
        bridge: null,
        commands: null,
        completion: null,
        settings: null,
        exportSettings: null,
      },
    } as any,
    fileManager: null,
    fileTreeManager: null,
    bridgeManager: null,
    assistantManager: null,
    providers: {
      bridge: null,
      commands: null,
      completion: null,
      settings: null,
      exportSettings: null,
    },
    ...overrides,
  };
}

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  managers?: Partial<Managers>;
  initialSidebarOpen?: boolean;
}

/**
 * Render a component inside the full React context tree. Provides every
 * provider the migrated component tree expects, so individual tests
 * don't have to remember the ordering or which subset their component
 * touches.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult & { managers: Managers } {
  const {
    managers: managerOverrides,
    initialSidebarOpen = true,
    ...rest
  } = options;
  const managers = buildManagers(managerOverrides);

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ManagersProvider value={managers}>
      <SettingsContextProvider>
        <ExportSettingsContextProvider>
          <AssistantContextProvider>
            <ModalsProvider>
              <PromptsProvider>
                <PropertiesProvider>
                  <UIStateProvider initialSidebarOpen={initialSidebarOpen}>
                    <FilesProvider>
                      <FileTreeProvider>{children}</FileTreeProvider>
                    </FilesProvider>
                  </UIStateProvider>
                </PropertiesProvider>
              </PromptsProvider>
            </ModalsProvider>
          </AssistantContextProvider>
        </ExportSettingsContextProvider>
      </SettingsContextProvider>
    </ManagersProvider>
  );

  return {
    ...render(ui, { wrapper, ...rest }),
    managers,
  };
}
