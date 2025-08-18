export {};
declare global {
  interface Window {
    api?: any;
    executionBridge?: any;
    mked?: {
      getActiveFilePath: () => string | null;
      pathDirName: (p: string) => string;
      resolvePath: (base: string, rel: string) => string;
    }
  }
}
