export {};
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
      getActiveFilePath: () => string | null;
      pathDirname: (p: string) => Promise<string>;
      resolvePath: (base: string, rel: string) => Promise<string>;
      openMkedUrl: (url: string) => Promise<string>;
    };
  }
}
