import { toast } from 'sonner';

/**
 * Toast level — maps to one of sonner's typed methods. Mirrors the
 * `status` strings the main process sends in `from:notification:display`
 * payloads, plus the legacy SweetAlert2 levels used by the renderer.
 */
export type ToastLevel = 'success' | 'error' | 'info' | 'warning';

type ToastFn = (message: string) => void;

const fns: Record<ToastLevel, ToastFn> = {
  success: (m) => toast.success(m),
  error: (m) => toast.error(m),
  info: (m) => toast.info(m),
  warning: (m) => toast.warning(m),
};

/**
 * Module-level toast emitter shared by React and non-React callers.
 * Lives outside `react/` so core modules (`BridgeListeners`) can import
 * it without crossing the manager/React boundary.
 *
 * Importing sonner here is safe because sonner buffers calls made
 * before `<Toaster />` mounts and replays them once it's ready.
 */
export function sonnerToast(level: string, message: string) {
  const fn = (fns as Record<string, ToastFn | undefined>)[level];
  if (fn) fn(message);
  else toast(message);
}
