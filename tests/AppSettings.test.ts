import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BrowserWindow } from 'electron';
import { AppSettings } from '../src/app/lib/AppSettings';

let mockHome: string;
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: () => mockHome,
}));
jest.mock('electron', () => ({ app: { getLocale: () => 'en-GB' } }));

describe('AppSettings migration', () => {
  let send: jest.Mock;
  let context: BrowserWindow;

  beforeEach(() => {
    mockHome = mkdtempSync(join(tmpdir(), 'mkeditor-settings-'));
    mkdirSync(join(mockHome, '.mkeditor'));
    send = jest.fn();
    context = { webContents: { send } } as unknown as BrowserWindow;
  });

  afterEach(() => rmSync(mockHome, { recursive: true, force: true }));

  it('applies missing defaults during this launch as well as persisting them', () => {
    writeFileSync(
      join(mockHome, '.mkeditor', 'settings.json'),
      JSON.stringify({
        darkmode: true,
        exportSettings: { fontSize: 22 },
      }),
    );
    const settings = new AppSettings(context);
    expect(settings.getSetting('darkmode')).toBe(true);
    expect(settings.getSetting('sessionRestore')).toBe(true);
    expect(settings.getSetting('exportSettings')).toMatchObject({
      fontSize: 22,
      withStyles: true,
      lineSpacing: 1.5,
    });
    expect(settings.getSetting('fileExplorer')).toEqual({ extensions: ['md'] });
    const persisted = JSON.parse(
      readFileSync(join(mockHome, '.mkeditor', 'settings.json'), 'utf-8'),
    );
    expect(persisted).toEqual(settings.getSettings());
  });

  it.each(['null', '[]', '42', '"settings"'])(
    'recovers from a valid JSON value that is not a settings object: %s',
    (value) => {
      writeFileSync(join(mockHome, '.mkeditor', 'settings.json'), value);
      const settings = new AppSettings(context);
      expect(settings.getSetting('wordwrap')).toBe(true);
      expect(settings.getSetting('exportSettings')?.withStyles).toBe(true);
      expect(send).toHaveBeenCalledWith('from:notification:display', {
        status: 'error',
        key: 'notifications:settings_file_corrupted_reset',
      });
    },
  );
});
