export type RecentType = 'folder' | 'file';

export interface RecentEntry {
  type: RecentType;
  uri: string; // file:// URI
  label: string; // display label
  lastOpened: number; // epoch ms
}

export interface StateFile {
  recent: {
    entries: RecentEntry[];
  };
}
