import { sonnerToast, type ToastLevel } from '../../notify';

export type { ToastLevel };

/**
 * React-side toast accessor.
 */
export function useNotify() {
  return sonnerToast;
}
