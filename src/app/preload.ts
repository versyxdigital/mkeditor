/**
 * Preload script.
 *
 * Main Bridge: AppBridge
 * Renderer Bridge: Bridge
 *
 * The contextBridge module provides a safe, bi-directional, synchronous
 * bridge across the isolated contexts.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { LogLevel } from './interfaces/Logging';

// Can be sent from the renderer process and
// received by the main process
const senderWhitelist = [
  'to:title:set',
  'to:editor:state',
  'to:settings:save',
  'to:session:save',
  'to:session:clear',
  'to:html:export',
  'to:pdf:export',
  'to:file:new',
  'to:file:open',
  'to:folder:open',
  'to:file:save',
  'to:file:saveas',
  'to:file:openpath',
  'to:file:create',
  'to:folder:create',
  'to:file:rename',
  'to:file:delete',
  'to:file:properties',
  'to:i18n:set',
  'to:window:minimize',
  'to:window:maximize',
  'to:window:close',
  'to:window:fullscreen',
  'to:command:run',
  'to:edit:cut',
  'to:edit:copy',
  'to:edit:paste',
  // AI Assistant (P1)
  'to:ai:chat',
  'to:ai:cancel',
  'to:ai:tool-result',
  'to:ai:config:get',
  'to:ai:config:set',
  'to:ai:key:set',
  'to:ai:key:clear',
  'to:ai:ollama:list',
  // AI Assistant (P7)
  'to:ai:conversations:save',
  'to:ai:conversations:flush',
];

// Can be sent from the main process and received
// by the renderer process
const receiverWhitelist = [
  'from:theme:set',
  'from:settings:set',
  'from:session:restore',
  'from:session:flush-request',
  'from:file:new',
  'from:file:open',
  'from:folder:open',
  'from:folder:opened',
  'from:file:opened',
  'from:file:save',
  'from:file:saveas',
  'from:modal:open',
  'from:command:palette',
  'from:notification:display',
  'from:path:properties',
  'from:path:renamed',
  'from:i18n:set',
  'from:window:state',
  // AI Assistant (P1)
  'from:ai:chunk',
  'from:ai:tool-call',
  'from:ai:done',
  'from:ai:error',
  'from:ai:config',
  'from:ai:ollama:models',
  // AI Assistant (P7)
  'from:ai:conversations',
  'from:ai:conversations:flush-request',
  // AI Assistant (P8) — application menu / tray
  'from:assistant:toggle',
];

/**
 * contextBridgeChannel utilises the ipcRenderer module to provide methods for
 * sending synchronous and asynchronous messages accross different execution contexts
 * (i.e. from the renderer process to the main process.).
 */
const contextBridgeChannel = () => {
  return {
    send: (channel: string, data: any) => {
      if (senderWhitelist.includes(channel)) {
        // Send an async message to te main process via whitelisted channel,
        // along with data.
        //
        // Note, arguments will be serialized with the structured clone algorithm,
        // so prototype chains will not be included. Sending functions, promises,
        // symbols, weakmaps, weaksets or DOM objects will throw an exception.
        ipcRenderer.send(channel, data);
      }
    },
    receive: (channel: string, fn: (...args: any[]) => void) => {
      if (receiverWhitelist.includes(channel)) {
        // Listen to channels and execute callack when messages are received.
        ipcRenderer.on(channel, (event, ...args) => {
          fn(...args);
        });
      }
    },
  };
};

/**
 * The "Main World" is the JavaScript context that the main renderer code runs in.
 *
 * When contextIsolation is enabled in webPreferences, the preload scripts run in an
 * "Isolated World" that is exposed to the "Main World" through the contextBridge.
 *
 * Docs: https://electronjs.org/docs/api/context-bridge
 */
contextBridge.exposeInMainWorld('executionBridge', contextBridgeChannel());

contextBridge.exposeInMainWorld('mked', {
  // Pinned at preload time: `process.platform` is authoritative here (the
  // preload runs in Node), avoiding a renderer-side UA sniff. Read once
  // by the composition root in `index.ts` and threaded through Managers.
  platform: process.platform,
  getActiveFilePath: () => ipcRenderer.sendSync('mked:get-active-file'),
  getAppLocale: () => ipcRenderer.sendSync('mked:get-locale'),
  openMkedUrl: (url: string) => ipcRenderer.send('mked:open-url', url),
  pathDirname: (p: string) => ipcRenderer.invoke('mked:path:dirname', p),
  resolvePath: (base: string, rel: string) =>
    ipcRenderer.invoke('mked:path:resolve', base, rel),
  /**
   * Read a file's contents without opening it as a tab. Used by the
   * AI assistant's `read_file` tool when the requested file isn't
   * already open — keeps tab-spam down when the agent is gathering
   * context across many files.
   */
  readFile: (path: string) =>
    ipcRenderer.invoke('mked:fs:readfile', path) as Promise<{
      content: string;
      lineCount: number;
    }>,
  /**
   * Write `content` to an existing or new file at `path`. Resolves
   * with `{ok: true, path}` on success or `{ok: false, error}` on
   * failure — used by the AI assistant's write-class tools so they
   * can report honest success/failure to the agent (the fire-and-
   * forget `to:file:save` channel used by the menu UI returns
   * nothing). Parent directories are created on demand.
   */
  saveFile: (path: string, content: string) =>
    ipcRenderer.invoke('mked:fs:savefile', path, content) as Promise<
      { ok: true; path: string } | { ok: false; error: string }
    >,
  /**
   * Create a new file at `parent/name` with `content`. Resolves with
   * `{ok: true, path}` on success or `{ok: false, error}` on failure.
   * Parent directories are created on demand. Used by the AI
   * assistant's `create_file` tool; the menu-driven flow continues
   * to use the existing fire-and-forget `to:file:create` channel.
   */
  createFile: (parent: string, name: string, content: string) =>
    ipcRenderer.invoke(
      'mked:fs:createfile',
      parent,
      name,
      content,
    ) as Promise<
      { ok: true; path: string } | { ok: false; error: string }
    >,
});

contextBridge.exposeInMainWorld('logger', {
  log(level: LogLevel, msg: string, meta?: unknown) {
    ipcRenderer.send('log', { level, msg, meta });
  },
  debug(msg: string, meta?: unknown) {
    ipcRenderer.send('log', { level: 'debug', msg, meta });
  },
  info(msg: string, meta?: unknown) {
    ipcRenderer.send('log', { level: 'info', msg, meta });
  },
  warn(msg: string, meta?: unknown) {
    ipcRenderer.send('log', { level: 'warn', msg, meta });
  },
  error(msg: string, meta?: unknown) {
    ipcRenderer.send('log', { level: 'error', msg, meta });
  },
});
