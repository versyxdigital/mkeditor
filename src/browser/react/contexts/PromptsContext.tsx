import * as React from 'react';

import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';

import type { PromptButton, PromptRequest, PromptResult } from '../../prompts';
export * from '../../prompts';

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
  const pendingRef = React.useRef<PendingPrompt | null>(null);
  const queueRef = React.useRef<PendingPrompt[]>([]);
  const mountedRef = React.useRef(true);

  const open = React.useCallback(
    (request: PromptRequest) =>
      new Promise<PromptResult>((resolve) => {
        if (!mountedRef.current) {
          resolve({ button: null });
          return;
        }
        const next = { request, resolve };
        if (pendingRef.current) {
          queueRef.current.push(next);
        } else {
          pendingRef.current = next;
          setPending(next);
        }
      }),
    [],
  );

  const handleResolve = React.useCallback((result: PromptResult) => {
    pendingRef.current?.resolve(result);
    const next = queueRef.current.shift() ?? null;
    pendingRef.current = next;
    setPending(next);
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    // Strict Mode may replay setup after cleanup without a fresh render.
    setPending(pendingRef.current);
    return () => {
      mountedRef.current = false;
      pendingRef.current?.resolve({ button: null });
      pendingRef.current = null;
      for (const entry of queueRef.current) entry.resolve({ button: null });
      queueRef.current = [];
    };
  }, []);

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
  }, [pending]);

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
