export {};

// Side-effect CSS imports (Tailwind entry, etc.) need an ambient module
// declaration under moduleResolution: "bundler". Webpack handles loading
// via style-loader + postcss-loader at build time.
declare module '*.css';

declare global {
  interface Window {
    api?: any;
    logger?: {
      log: (level: Level, msg: string, meta?: unknown) => void;
      debug: (msg: string, meta?: unknown) => void;
      info: (msg: string, meta?: unknown) => void;
      warn: (msg: string, meta?: unknown) => void;
      error: (msg: string, meta?: unknown) => void;
    };
    executionBridge?: any;
    mked?: {
      platform: NodeJS.Platform;
      getActiveFilePath: () => string | null;
      getAppLocale: () => string;
      pathDirname: (p: string) => Promise<string>;
      resolvePath: (base: string, rel: string) => Promise<string>;
      openMkedUrl: (url: string) => Promise<string>;
      secureChannelPublicKey: () => string;
      readFile: (
        path: string,
      ) => Promise<{ content: string; lineCount: number }>;
      saveFile: (
        path: string,
        content: string,
      ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
      createFile: (
        parent: string,
        name: string,
        content: string,
      ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
      createFolder: (
        parent: string,
        name: string,
      ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
      pasteImage: (opts: {
        sourceFile: string;
        directory: string;
        bytes: Uint8Array;
        extension: string;
      }) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
    };
    setLanguage: (lng: string) => void;
  }
}
