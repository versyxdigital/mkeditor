export interface ContextBridgeAPI {
  send: (channel: string, data: any) => void;
  receive: (channel: string, fn: (...args: any[]) => void) => void;
}

export interface ContextBridgedFile {
  file: string;
  filename: string;
  content: string;
}