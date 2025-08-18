export {};
declare global {
  interface Window {
    api?: any;
    executionBridge?: any;
    mked?: {
      getActiveFilePath: () => string | null;
      pathDirname: (p: string) => Promise<string>;
      resolvePath: (base: string, rel: string) => Promise<string>;
      openMkedUrl: (url: string) => Promise<string>;
    };
  }
}
