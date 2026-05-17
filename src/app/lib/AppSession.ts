import { homedir } from 'os';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { normalize } from 'path';
import type { SessionPayload, SessionTab } from '../interfaces/Session';

/**
 * AppSession
 *
 * Persists the renderer's open-tab / cursor / scroll session to
 * `~/.mkeditor/session.json` and reads it back at boot.
 *
 * The write is atomic: `session.json.tmp` is written first, then
 * `renameSync` swaps it into place. A power loss during the write
 * leaves either the prior canonical file intact or the new one, never
 * a truncated mix.
 *
 * Sibling to `AppSettings` but intentionally simpler — there's no
 * defaulting, no deep-merge, no notification side effects. The
 * renderer is the source of truth for shape; main only stewards
 * the JSON.
 */
export class AppSession {
  /** Application config dir (shared with AppSettings). */
  private static readonly appPath = normalize(homedir() + '/.mkeditor/');

  /** Canonical session file path. */
  private static readonly filePath = AppSession.appPath + 'session.json';

  /** Tmp path used by the atomic write. */
  private static readonly tmpPath = AppSession.filePath + '.tmp';

  /** Current schema version we know how to load. */
  private static readonly SCHEMA_VERSION = 1;

  /**
   * Read and validate the persisted session. Returns null if:
   *   - the file is absent
   *   - the JSON fails to parse
   *   - the parsed payload doesn't match `SessionPayload` shape
   *   - the schema version doesn't match `SCHEMA_VERSION`
   *
   * Never throws. Callers should treat null as "no prior session".
   */
  static load(): SessionPayload | null {
    if (!existsSync(AppSession.filePath)) return null;

    let raw: string;
    try {
      raw = readFileSync(AppSession.filePath, { encoding: 'utf-8' });
    } catch {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!AppSession.isValidPayload(parsed)) return null;
    return parsed;
  }

  /**
   * Persist the session payload to disk atomically.
   *
   * Strategy: write to `session.json.tmp`, then `renameSync` into the
   * canonical path. POSIX rename is atomic; Windows NTFS rename is
   * atomic enough for our purposes (same volume).
   *
   * Synchronous so the `before-quit` flush can complete before the
   * process exits. Catches and swallows all errors — a failed session
   * write must never block app quit.
   */
  static save(payload: SessionPayload): void {
    try {
      if (!existsSync(AppSession.appPath)) {
        mkdirSync(AppSession.appPath, { recursive: true });
      }

      // Stamp the schema version on every write, even if the caller
      // supplied a different value — the canonical file is always at
      // the loader's known version.
      const serialised = JSON.stringify(
        { ...payload, version: AppSession.SCHEMA_VERSION },
        null,
        2,
      );

      writeFileSync(AppSession.tmpPath, serialised, { encoding: 'utf-8' });
      renameSync(AppSession.tmpPath, AppSession.filePath);
    } catch {
      // Best-effort cleanup of a leftover tmp; ignore any failure.
      try {
        if (existsSync(AppSession.tmpPath)) unlinkSync(AppSession.tmpPath);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Shape-check a parsed payload. Conservative: anything that doesn't
   * match exactly falls back to "no session". Better to start fresh
   * than to crash on a forward-incompatible file.
   */
  private static isValidPayload(value: unknown): value is SessionPayload {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Partial<SessionPayload>;
    if (candidate.version !== AppSession.SCHEMA_VERSION) return false;
    if (!Array.isArray(candidate.tabs)) return false;
    if (
      candidate.activeFile !== null &&
      typeof candidate.activeFile !== 'string'
    ) {
      return false;
    }
    for (const tab of candidate.tabs) {
      if (!AppSession.isValidTab(tab)) return false;
    }
    return true;
  }

  private static isValidTab(value: unknown): value is SessionTab {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Partial<SessionTab>;
    if (typeof candidate.path !== 'string') return false;
    if (typeof candidate.name !== 'string') return false;
    if (
      'untitledContent' in candidate &&
      typeof candidate.untitledContent !== 'string'
    ) {
      return false;
    }
    return true;
  }
}
