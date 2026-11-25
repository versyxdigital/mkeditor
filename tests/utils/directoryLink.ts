import { symlinkSync } from 'fs';

/** Junctions exercise real Windows link resolution without administrator privileges. */
export function createDirectoryLink(target: string, link: string): void {
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}
