import type { ToolConfirmPreview } from './core/AssistantTools';

/**
 * Module-level seam for the tool-call confirm dialog.
 *
 * The React `<ToolConfirmProvider>` registers its `open` callback
 * here at mount via `registerToolConfirmOpener`. Manager-side code
 * (today: `AssistantManager.runWithConfirmation` when a write-class
 * tool fires without auto-accept) calls `confirmToolCallExternal`
 * to surface the dialog and await the user's decision — without
 * ever importing React.
 *
 * Lives at `src/browser/` (NOT under `react/`) so the manager →
 * React import is one-way: managers see this neutral seam file;
 * React imports the seam to plug in its dialog. Same pattern as
 * `src/browser/notify.ts` (sonner toast) and the other module-level
 * seams that bridge the boundary.
 */

/**
 * One pending tool-call confirmation. AssistantManager fills this in
 * when a write-class tool fires (and the conversation doesn't have
 * auto-accept on); `<ToolConfirmDialog>` renders it.
 */
export interface ToolConfirmRequest {
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  preview: ToolConfirmPreview | null;
}

let externalOpen:
  | ((req: ToolConfirmRequest) => Promise<boolean>)
  | null = null;

export function registerToolConfirmOpener(
  fn: (req: ToolConfirmRequest) => Promise<boolean>,
): void {
  externalOpen = fn;
}

/**
 * Open the tool-call confirm dialog from non-React code. Resolves
 * with `true` on accept, `false` on reject / dismiss / no-provider.
 *
 * If the React tree hasn't mounted the provider yet (early boot),
 * the call resolves false — write-class tools fail closed rather
 * than silently executing without the user's OK.
 */
export function confirmToolCallExternal(
  req: ToolConfirmRequest,
): Promise<boolean> {
  if (!externalOpen) return Promise.resolve(false);
  return externalOpen(req);
}
