/**
 * Internal helper module for `~/.mkeditor/assistant.json` I/O.
 *
 * Both `AssistantKeyStore` and `AssistantConfig` need to read and write
 * the same file (different sections of the same JSON blob). They both
 * read the whole file, modify their section, and write the whole file
 * back atomically. Putting the I/O here keeps the two classes peers
 * rather than one depending on the other.
 *
 * Not exported from `lib/index` (no such barrel exists) — only the two
 * sibling classes import from here.
 */

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
import type { AssistantStoreFile, ProviderId } from '../interfaces/Assistant';
import { DEFAULT_PROVIDER_CONFIG } from '../interfaces/Assistant';

export const ASSISTANT_STORE_VERSION = 1;

const APP_PATH = normalize(homedir() + '/.mkeditor/');
const FILE_PATH = APP_PATH + 'assistant.json';
const TMP_PATH = FILE_PATH + '.tmp';

export const assistantStorePath = (): string => FILE_PATH;
export const assistantStoreTmpPath = (): string => TMP_PATH;
export const assistantStoreDir = (): string => APP_PATH;

const fallback = (): AssistantStoreFile => ({
  version: ASSISTANT_STORE_VERSION,
  providers: DEFAULT_PROVIDER_CONFIG,
  keys: {},
});

/**
 * Load the on-disk store, or return a defaulted shape if the file is
 * missing / corrupt / schema-mismatched. Never throws.
 */
export function loadAssistantStore(): AssistantStoreFile {
  if (!existsSync(FILE_PATH)) return fallback();

  let raw: string;
  try {
    raw = readFileSync(FILE_PATH, { encoding: 'utf-8' });
  } catch {
    return fallback();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback();
  }

  if (!isValidStore(parsed)) return fallback();
  return parsed;
}

/**
 * Atomic write of the whole store (tmp + rename — same pattern as
 * `AppSession.save`). Returns true on success, false on any IO failure.
 * Never throws. Best-effort cleanup of a leftover tmp on failure.
 *
 * Stamps the current schema version on every write regardless of caller
 * input, so the canonical file on disk always matches the loader's
 * expected version.
 */
export function writeAssistantStore(store: AssistantStoreFile): boolean {
  try {
    if (!existsSync(APP_PATH)) {
      mkdirSync(APP_PATH, { recursive: true });
    }
    const serialised = JSON.stringify(
      { ...store, version: ASSISTANT_STORE_VERSION },
      null,
      2,
    );
    writeFileSync(TMP_PATH, serialised, { encoding: 'utf-8' });
    renameSync(TMP_PATH, FILE_PATH);
    return true;
  } catch {
    try {
      if (existsSync(TMP_PATH)) unlinkSync(TMP_PATH);
    } catch {
      // best-effort
    }
    return false;
  }
}

/**
 * Shape-check a parsed payload. Conservative: anything that doesn't
 * match falls back to defaults rather than throwing.
 */
function isValidStore(value: unknown): value is AssistantStoreFile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AssistantStoreFile>;
  if (candidate.version !== ASSISTANT_STORE_VERSION) return false;
  if (
    typeof candidate.providers !== 'object' ||
    candidate.providers === null
  ) {
    return false;
  }
  if (typeof candidate.keys !== 'object' || candidate.keys === null) {
    return false;
  }
  for (const provider of ['anthropic', 'openai', 'ollama'] as ProviderId[]) {
    if (!(provider in candidate.providers)) return false;
  }
  return true;
}
