export {};
declare global {
  interface Window {
    api?: any;
    executionBridge?: any;
    mked?: {
      getActiveFilePath: () => string | null;
      pathDirname: (p: string) => string;
      resolvePath: (base: string, rel: string) => string;
      openMkedUrl: (url: string) => string;
    };
  }
}
