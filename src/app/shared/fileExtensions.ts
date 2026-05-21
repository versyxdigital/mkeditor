/**
 * Single source of truth for the workspace's curated file-extension
 * allowlist.
 *
 * Three modules need to agree on this set:
 *   - `src/app/lib/AppStorage.readDirectory` (Electron main): the
 *     server-side filter applied while walking the workspace tree.
 *   - `src/browser/core/WebFileBridge.listChildren` (web build): the
 *     equivalent filter when the workspace is served by the File
 *     System Access API.
 *   - `src/browser/react/components/FileTreeFilterBar` (UI): the
 *     checkbox list the user toggles to narrow the visible types
 *     further on the client side.
 *
 * Adding a new type means editing exactly one place — this file.
 *
 * Why under `src/app/shared/` and not a top-level `src/shared/`:
 * the main-process `tsconfig.json` has `rootDir: "."` (i.e.
 * `src/app/`), so files outside that root aren't picked up by the
 * main tsc invocation. Keeping the shared module inside `src/app/`
 * keeps the Electron build trivial; the renderer's webpack +
 * ts-loader resolve the cross-folder import without complaint
 * (`src/browser/...` → `../../app/shared/fileExtensions`).
 *
 * The module is intentionally pure data — no imports, no
 * platform-specific code — so importing it from either side has
 * zero runtime cost beyond the array literal.
 */

export interface WorkspaceExtensionGroup {
  /** i18n key suffix under `sidebar:filter_section_*`. */
  readonly key: 'markdown' | 'images' | 'documents';
  /** Extensions in this group (lower-case, no leading dot). */
  readonly extensions: ReadonlyArray<string>;
}

/** Grouped form — drives the funnel popover's section headings. */
export const WORKSPACE_EXTENSION_GROUPS: ReadonlyArray<WorkspaceExtensionGroup> =
  [
    { key: 'markdown', extensions: ['md'] },
    { key: 'images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] },
    { key: 'documents', extensions: ['html', 'pdf', 'txt'] },
  ] as const;

/**
 * Flat list of every curated extension (lower-case, no leading dot).
 * Use this when you want to drive checkbox iteration or persist the
 * user's current selection — the persisted shape uses the no-dot
 * form so it round-trips cleanly through JSON.
 */
export const WORKSPACE_EXTENSIONS: ReadonlyArray<string> =
  WORKSPACE_EXTENSION_GROUPS.flatMap((g) => g.extensions);

/**
 * Pre-built lookup set for `name.endsWith(ext)`-style checks where a
 * leading dot is more ergonomic than slicing the basename. Used by
 * both `AppStorage.readDirectory` and `WebFileBridge.listChildren`.
 */
export const WORKSPACE_EXTENSIONS_DOTTED: ReadonlySet<string> = new Set(
  WORKSPACE_EXTENSIONS.map((ext) => `.${ext}`),
);
