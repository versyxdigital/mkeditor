import { editor } from 'monaco-editor';
import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type { File, FileProperties, RenamedPath } from '../interfaces/File';
import type { BridgeProviders } from '../interfaces/Providers';
import type { SettingsFile } from '../interfaces/Editor';
import type { SessionRestoreEnvelope } from '../interfaces/Session';
import type {
  ChatChunkEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatToolCallEvent,
  ConfigPushPayload,
  OllamaModelsEvent,
  PersistedConversations,
} from '../../app/interfaces/Assistant';
import type { EditorDispatcher } from '../events/EditorDispatcher';
import type { BridgeManager } from './BridgeManager';
import type { FileManager } from './FileManager';
import type { FileTreeManager } from './FileTreeManager';
import {
  openModalExternal,
  type ModalKey,
} from '../react/contexts/ModalsContext';
// Neutral seam at `src/browser/assistantUiState.ts` — NOT a React
// import. React's <UIStateProvider> registers its setters at
// mount; we call them through these module-level functions
// without touching React.
import {
  applyRestoredAssistantState,
  toggleRightSidebarExternal,
} from '../assistantUiState';
import { sonnerToast } from '../notify';
import { showPropertiesExternal } from '../react/contexts/PropertiesContext';
import { basename } from '../util';
import { t, whenLanguageReady } from '../i18n';

/**
 * Register bridge channel listeners.
 */
export function registerBridgeListeners(
  bridge: ContextBridgeAPI,
  mkeditor: editor.IStandaloneCodeEditor,
  dispatcher: EditorDispatcher,
  providers: BridgeProviders,
  files: FileManager,
  tree: FileTreeManager,
  manager: BridgeManager,
) {
  const loadSettingsFromBridgeListener = (settings: SettingsFile) => {
    mkeditor.updateOptions({
      autoIndent: settings.autoindent ? 'advanced' : 'none',
    });

    mkeditor.updateOptions({
      wordWrap: settings.wordwrap ? 'on' : 'off',
    });

    mkeditor.updateOptions({
      renderWhitespace: settings.whitespace ? 'all' : 'none',
    });

    mkeditor.updateOptions({
      minimap: { enabled: settings.minimap },
    });
  };

  // Set the theme according to the user's system theme. React
  // subscribes to SettingsProvider's emitter so the navbar
  // darkmode toggle reflects the change.
  bridge.receive('from:theme:set', (shouldUseDarkMode: boolean) => {
    if (shouldUseDarkMode) {
      providers.settings?.updateSetting('darkmode', shouldUseDarkMode);
    }
  });

  // Set settings from stored settings file (%HOME%/.mkeditor/settings.json).
  // The providers' setSettings emits to SettingsContext / ExportSettingsContext
  // subscribers and the React modals re-render to reflect the loaded values.
  bridge.receive('from:settings:set', (s: SettingsFile) => {
    loadSettingsFromBridgeListener(s);
    providers.settings?.setSettings(s);
    providers.exportSettings?.setSettings(s.exportSettings);
  });

  // File / folder menu actions delegate to BridgeManager helpers so the
  // in-window TitleBar menu can reach the same effects without
  // re-routing through `bridge.receive`.
  bridge.receive('from:file:new', () => manager.menuFileNew());
  bridge.receive('from:file:save', () => manager.menuFileSave());
  bridge.receive('from:file:saveas', () => manager.menuFileSaveAs());
  bridge.receive('from:folder:open', () => manager.menuFolderOpen());

  // Handle post-folder open events
  bridge.receive('from:folder:opened', async ({ tree: t, path }) => {
    const rootChanged = !tree.treeRoot || !path.startsWith(tree.treeRoot);
    // Genuine workspace switch (had a root, now have a different one).
    const switchingWorkspace = rootChanged && tree.treeRoot !== null;
    if (switchingWorkspace) {
      const proceed = await files.closeAllTabsForWorkspaceSwitch();
      if (!proceed) {
        // User cancelled the unsaved-changes prompt. Don't adopt the
        // new tree, don't publish the new workspace root to main.
        tree.openingFolder = false;
        return;
      }
    }
    if (tree.openingFolder || rootChanged) {
      tree.treeRoot = path;
      tree.openingFolder = false;
    }
    tree.buildFileTree(t, path);
    // Persist the new workspace root if it changed. Sub-directory
    // expands (lazy-load) reuse the existing root, so they don't need
    // their own save trigger.
    if (rootChanged) {
      files.scheduleSessionSave();
      // Publish the new workspace root to main so the `mked:fs:*`
      // handlers (AI assistant file ops) can enforce it as their
      // trust boundary. Without this, any `mked:fs:*` invoke would
      // be denied because main's workspaceRoot stays null.
      bridge.send('to:workspace:set', { root: path });
    }
  });

  // Enable opening files from outside of the renderer execution context.
  bridge.receive('from:file:open', () => manager.menuFileOpen());

  // Handle post-file open events. We ignore the `filename` field in
  // the payload and derive the tab label from the path's basename
  // (POSIX `/` or Win `\`). Main's setActiveFile used to split only
  // on `\`, so on Linux/macOS the renderer was receiving the full
  // path as `filename` and rendering it in the tab. The Navbar reads
  // the active file's PATH for the title bar — the tab itself only
  // shows the filename.
  bridge.receive('from:file:opened', ({ content, file }: File) => {
    const path = file || `untitled-${files.untitledCounter++}`;
    const name = file
      ? basename(file)
      : `Untitled ${files.untitledCounter - 1}`;

    if (files.models.has(path)) {
      // Already open — just activate.
      tree.addFileToTree(path);
      files.activateFile(path, name);
      files.openingFile = false;
      return;
    }

    // If the active tab is an untitled scratch buffer and we have a real
    // file path, replace the untitled in place (preserves the typed
    // content's model identity and tab position).
    if (file && files.replaceUntitled(path, name, content)) {
      tree.addFileToTree(path);
      files.activateFile(path, name);
      files.openingFile = false;
      return;
    }

    // Fallback: create a fresh model + tab.
    const mdl = editor.createModel(content, 'markdown');
    files.models.set(path, mdl);
    files.originals.set(path, content);
    files.trackTab(path, mdl);
    files.addTab(name, path);

    tree.addFileToTree(path);
    files.activateFile(path, name);
    files.openingFile = false;
  });

  // Enable renaming of files and folders. Same basename derivation as
  // from:file:opened so the tab label stays consistent across OSes.
  bridge.receive('from:path:renamed', ({ oldPath, newPath }: RenamedPath) => {
    files.renameTab(oldPath, newPath, basename(newPath));
  });

  // Enable access to the monaco editor command palette.
  bridge.receive('from:command:palette', () => manager.menuCommandPalette());

  // Opens a React shadcn-Dialog modal triggered from the main process
  // (e.g., a tray/menu item).
  bridge.receive(
    'from:modal:open',
    (modal: ModalKey | { modal: ModalKey; tab?: 'general' | 'assistant' }) => {
      // Payload may be either the bare modal key (most callers)
      // or `{ modal, tab? }` for the Help → Configure AI
      // Providers menu item that needs to open the Settings
      // modal directly on the AI Providers tab.
      if (typeof modal === 'string') {
        openModalExternal(modal);
      } else if (modal && typeof modal.modal === 'string') {
        openModalExternal(
          modal.modal,
          modal.tab ? { tab: modal.tab } : undefined,
        );
      }
    },
  );

  // Enable notifications from the main context. Translation is deferred
  // behind `whenLanguageReady()` so a "settings saved" toast that
  // arrives during a locale switch is rendered in the *new* language —
  // the locale-change IPC and the settings-save IPC race back from the
  // main process, and without this guard the toast would resolve
  // against the previous language's bundle.
  bridge.receive('from:notification:display', (event: any) => {
    const { status } = event || {};
    const key: string | undefined = event?.key;
    const values: Record<string, unknown> | undefined = event?.values;
    const message: string | undefined = event?.message;

    const show = () => {
      const text = key
        ? t(key, values)
        : typeof message === 'string'
          ? message
          : '';
      if (text) sonnerToast(status || 'info', text);
    };

    if (key) {
      void whenLanguageReady().then(show);
    } else {
      show();
    }
  });

  // Trigger the file properties window from the context menu.
  bridge.receive('from:path:properties', (info: FileProperties) => {
    showPropertiesExternal(info);
  });

  // Replay the persisted session into FileManager. The envelope was
  // pre-filtered by main (missing real-file paths excluded, contents
  // pre-loaded), so the tab replay is purely in-renderer + synchronous.
  // The workspace folder restore is the one async step: we ask main
  // to re-walk the persisted root via `to:file:openpath`, which fires
  // the normal `from:folder:opened` flow.
  bridge.receive('from:session:restore', (envelope: SessionRestoreEnvelope) => {
    if (envelope?.missing && envelope.missing.length > 0) {
      sonnerToast(
        'warning',
        t('notifications:session_file_missing', {
          files: envelope.missing.join(', '),
        }),
      );
    }
    if (envelope) files.restoreSession(envelope);
    // If nothing landed (no session and no CLI-arg file is queued to
    // open), seed an `untitled-1` from the welcome markdown that
    // Monaco was created with. Mirrors the web boot pattern and
    // avoids "editor has content, but no tab" first-launch UX.
    // If a CLI file *is* about to open, the `from:file:opened`
    // handler's `replaceUntitled` swap absorbs this seed in place.
    if (files.tabs.size === 0) {
      files.seedUntitled(mkeditor.getValue());
    }
    const root = envelope?.session?.workspaceRoot;
    if (root) {
      // Mark openingFolder so `from:folder:opened` treats this as a
      // root populate rather than a lazy-load.
      tree.openingFolder = true;
      bridge.send('to:file:openpath', { path: root });
    }
    // Forward the assistant right-sidebar view-state (open + size)
    // into UIStateContext via the module-level seam. v1 session
    // payloads omit this block; UIStateContext keeps its initial
    // defaults in that case.
    const assistant = envelope?.session?.assistant;
    if (assistant) {
      applyRestoredAssistantState(assistant);
    }
  });

  // Final flush ahead of quit. Main's `before-quit` hook sends this
  // and waits up to ~250 ms for the `to:session:save` ack — so the
  // serialisation runs synchronously here and we ship immediately.
  bridge.receive('from:session:flush-request', () => {
    bridge.send('to:session:save', files.serializeSession());
  });

  // BrowserWindow maximize/unmaximize state — `<TitleBar>`'s maximize
  // icon reads this through WindowContext via BridgeManager's snapshot.
  bridge.receive(
    'from:window:state',
    (state: { isMaximized: boolean } | undefined) => {
      manager.setWindowState({ isMaximized: !!state?.isMaximized });
    },
  );

  // ---- AI Assistant ----------------------------------------------
  //
  // Sanitized config snapshot the renderer reads — never carries any
  // key value, only `hasKey: boolean` per provider. `AssistantManager`
  // diffs the snapshot and notifies React subscribers.
  bridge.receive('from:ai:config', (payload: ConfigPushPayload) => {
    manager.assistantManager.setConfigFromServer(payload);
  });

  // Ollama model-list reply. AssistantManager has the pending Promise
  // resolver keyed by callId; late deliveries are silently dropped.
  bridge.receive('from:ai:ollama:models', (payload: OllamaModelsEvent) => {
    manager.assistantManager.onOllamaModels(payload);
  });

  // Chat streaming chunks. AssistantManager.appendChunk no-ops when
  // the callId doesn't belong to a tracked chat (e.g. a stray
  // text-delta from a connection-test ping) so we route every
  // chunk through unconditionally.
  bridge.receive('from:ai:chunk', (payload: ChatChunkEvent) => {
    manager.assistantManager.appendChunk(payload.callId, payload.text);
  });

  // Chat completion / error events. AssistantManager.onChatDone /
  // onChatError handle both the connection-test path and the
  // in-flight chat path internally (test pending first, then chat).
  // Foreign callIds are silently ignored.
  bridge.receive('from:ai:done', (payload: ChatDoneEvent) => {
    manager.assistantManager.onChatDone(payload.callId);
  });
  bridge.receive('from:ai:error', (payload: ChatErrorEvent) => {
    manager.assistantManager.onChatError(payload);
  });

  // Tool-call events. AssistantManager classifies read vs write,
  // executes read-class immediately, prompts for write-class
  // (or auto-accepts based on per-conversation toggle).
  bridge.receive('from:ai:tool-call', (payload: ChatToolCallEvent) => {
    manager.assistantManager.onToolCall(payload);
  });

  // Persisted conversation hydration. Fired once by main on
  // `did-finish-load` after the AI config push. Pre-persistence
  // store files arrive as `null` (no conversations block); restore
  // handles that as "no history".
  bridge.receive(
    'from:ai:conversations',
    (payload: PersistedConversations | null) => {
      manager.assistantManager.restore(payload);
    },
  );

  // Quit-flush request. Main fires this before-quit so any
  // in-flight 500 ms debounce window doesn't lose the last
  // conversation mutation. AssistantManager.flushPersist() cancels
  // the pending timer and synchronously ships the latest serialize()
  // via the `to:ai:conversations:flush` channel, which main awaits
  // (paired with the session flush) before app.quit().
  bridge.receive('from:ai:conversations:flush-request', () => {
    manager.assistantManager.flushPersist();
  });

  // Application menu (View → Toggle Assistant Sidebar,
  // Cmd/Ctrl+Shift+A) and the system tray entry fire this channel.
  // Routes through the UIStateContext seam so non-React main /
  // menu code can flip the sidebar.
  bridge.receive('from:assistant:toggle', () => {
    toggleRightSidebarExternal();
  });
}
