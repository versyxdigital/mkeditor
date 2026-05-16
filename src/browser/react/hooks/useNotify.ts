import { sonnerToast, type ToastLevel } from '../../notify';

export type { ToastLevel };

/**
 * React-side toast accessor. Just re-exports the neutral `sonnerToast`
 * function from `src/browser/notify.ts` for consistency with the other
 * Phase 7+ hooks. The function reference is stable.
 */
export function useNotify() {
  return sonnerToast;
}
