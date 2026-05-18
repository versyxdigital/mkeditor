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
      readFile: (path: string) => Promise<{ content: string; lineCount: number }>;
    };
    setLanguage: (lng: string) => void;
  }
}
