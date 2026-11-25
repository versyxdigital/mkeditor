export interface PromptButton {
  id: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface PromptRequest {
  title: string;
  description?: string;
  /** When provided, the dialog renders a single text input. */
  input?: {
    placeholder?: string;
    defaultValue?: string;
  };
  buttons: readonly PromptButton[];
}

export type PromptResult = {
  /** `null` when the dialog is dismissed (Esc / overlay click). */
  button: string | null;
  /** Present iff `request.input` was set; the typed value. */
  value?: string;
};

let externalOpen: ((req: PromptRequest) => Promise<PromptResult>) | null = null;

export function registerPromptOpener(
  fn: (req: PromptRequest) => Promise<PromptResult>,
) {
  externalOpen = fn;
}

/**
 * Open an arbitrary prompt from non-React code. Returns a result with
 * the selected button id (or null for dismiss) and, if `request.input`
 * was set, the typed value.
 *
 * If the React tree has not yet mounted the `<PromptsProvider>`, the
 * call resolves with `{ button: null }` (treated as a cancel).
 */
export function openPromptExternal(
  request: PromptRequest,
): Promise<PromptResult> {
  if (!externalOpen) return Promise.resolve({ button: null });
  return externalOpen(request);
}

/**
 * Sugar for a yes/no confirm dialog. Resolves to `true` only when the
 * user clicks the confirm action (id `confirm`).
 */
export async function confirmExternal(opts: {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
}): Promise<boolean> {
  const result = await openPromptExternal({
    title: opts.title,
    description: opts.description,
    buttons: [
      {
        id: 'cancel',
        label: opts.cancelLabel,
        variant: 'secondary',
      },
      {
        id: 'confirm',
        label: opts.confirmLabel,
        variant: opts.destructive ? 'danger' : 'primary',
      },
    ],
  });
  return result.button === 'confirm';
}

/**
 * Sugar for a single-input prompt. Resolves to the typed string when
 * confirmed (or `null` when cancelled / empty).
 */
export async function promptExternal(opts: {
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel: string;
  cancelLabel: string;
}): Promise<string | null> {
  const result = await openPromptExternal({
    title: opts.title,
    description: opts.description,
    input: {
      placeholder: opts.placeholder,
      defaultValue: opts.defaultValue,
    },
    buttons: [
      { id: 'cancel', label: opts.cancelLabel, variant: 'secondary' },
      { id: 'confirm', label: opts.confirmLabel, variant: 'primary' },
    ],
  });
  if (result.button !== 'confirm') return null;
  const value = (result.value ?? '').trim();
  return value.length > 0 ? value : null;
}
