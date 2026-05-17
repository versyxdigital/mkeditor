import * as React from 'react';

import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';

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

interface PendingPrompt {
  request: PromptRequest;
  resolve: (result: PromptResult) => void;
}

interface PromptsContextValue {
  /** Open a prompt and await the user's response. */
  open: (request: PromptRequest) => Promise<PromptResult>;
}

const PromptsContext = React.createContext<PromptsContextValue | null>(null);

/**
 * Centralised dialog driverr, React-rendered `<Dialog>` whose buttons resolve
 * a promise. Used by:
 *   - `FileManager.closeTab` (3-button unsaved-changes confirm)
 *   - explorer right-click menu (rename/new/delete/confirm)
 *
 * Non-React callers go through `promptExternal` / `confirmExternal` /
 * `openPromptExternal` (see bottom of file).
 */
export const PromptsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [pending, setPending] = React.useState<PendingPrompt | null>(null);

  const open = React.useCallback(
    (request: PromptRequest) =>
      new Promise<PromptResult>((resolve) => {
        setPending({ request, resolve });
      }),
    [],
  );

  const handleResolve = React.useCallback(
    (result: PromptResult) => {
      pending?.resolve(result);
      setPending(null);
    },
    [pending],
  );

  const value = React.useMemo(() => ({ open }), [open]);

  return (
    <PromptsContext.Provider value={value}>
      {children}
      <PromptDialog pending={pending} onResolve={handleResolve} />
    </PromptsContext.Provider>
  );
};

export function usePrompts(): PromptsContextValue {
  const ctx = React.useContext(PromptsContext);
  if (!ctx) throw new Error('usePrompts() called outside <PromptsProvider>');
  return ctx;
}

/* -------------------------------------------------------------------- */
/*  PromptDialog                                                        */
/* -------------------------------------------------------------------- */

const buttonVariantFor = (
  variant: PromptButton['variant'],
): React.ComponentProps<typeof Button>['variant'] => {
  switch (variant) {
    case 'danger':
      return 'destructive';
    case 'secondary':
      return 'secondary';
    case 'primary':
    default:
      return 'default';
  }
};

const PromptDialog: React.FC<{
  pending: PendingPrompt | null;
  onResolve: (r: PromptResult) => void;
}> = ({ pending, onResolve }) => {
  const request = pending?.request ?? null;
  const [value, setValue] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Reset/seed the input each time a new prompt opens. Without this
  // the previous prompt's value would persist into the next one.
  React.useEffect(() => {
    if (!request) return;
    setValue(request.input?.defaultValue ?? '');
  }, [request]);

  const open = pending !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onResolve({ button: null });
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-w-md"
        // Stop Radix's autofocus stealing focus from the input.
        onOpenAutoFocus={(e) => {
          if (request?.input) {
            e.preventDefault();
            inputRef.current?.focus();
            inputRef.current?.select();
          }
        }}
      >
        {request && (
          <>
            <DialogHeader>
              <DialogTitle>{request.title}</DialogTitle>
            </DialogHeader>
            <div className="px-4 pb-4 text-sm">
              {request.description && (
                <p className="mb-3 text-muted-foreground">
                  {request.description}
                </p>
              )}
              {request.input && (
                <Input
                  ref={inputRef}
                  type="text"
                  className="mb-3"
                  placeholder={request.input.placeholder}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      // Find the first non-cancel button (the primary
                      // action) and resolve with it.
                      const primary = request.buttons.find(
                        (b) => b.id !== 'cancel',
                      );
                      if (primary) {
                        e.preventDefault();
                        onResolve({ button: primary.id, value });
                      }
                    }
                  }}
                />
              )}
              <div className="flex justify-end gap-2">
                {request.buttons.map((btn) => (
                  <Button
                    key={btn.id}
                    type="button"
                    size="sm"
                    variant={buttonVariantFor(btn.variant)}
                    onClick={() =>
                      onResolve({
                        button: btn.id,
                        ...(request.input ? { value } : {}),
                      })
                    }
                  >
                    {btn.label}
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

/* -------------------------------------------------------------------- */
/*  Module-level entrypoints for non-React callers                      */
/* -------------------------------------------------------------------- */

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
