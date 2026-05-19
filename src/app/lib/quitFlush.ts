/**
 * Quit-flush orchestrator. Extracted from `main.ts` so the dual-ack
 * fan-out (session + AI conversations) can be tested in isolation.
 *
 * Behaviour: fire both `from:*:flush-request` notifications to the
 * renderer, then wait for BOTH ack channels (`to:session:save` and
 * `to:ai:conversations:flush`) to land. Resolve when both arrive OR
 * after `timeoutMs` (default 250 ms) — whichever comes first.
 *
 * The renderer's debounced saves cover everything except the very
 * last keystroke / message, so a missed ack just costs a few hundred
 * ms of unpersisted activity, not data loss. Worst-case timeout still
 * fires `onDone` so `app.quit()` isn't blocked.
 */

export interface QuitFlushDeps {
  /** Subscribe to an ack channel; returns an unsubscribe function. */
  on: (
    channel: 'to:session:save' | 'to:ai:conversations:flush',
    listener: () => void,
  ) => void;
  /** Remove a previously-registered listener. Mirrors `ipcMain.removeListener`. */
  off: (
    channel: 'to:session:save' | 'to:ai:conversations:flush',
    listener: () => void,
  ) => void;
  /** Send a notification channel to the renderer. */
  send: (
    channel:
      | 'from:session:flush-request'
      | 'from:ai:conversations:flush-request',
    payload?: unknown,
  ) => void;
  /** Fires once when both acks have landed OR the timeout has elapsed. Idempotent. */
  onDone: () => void;
  /** Safety timeout in ms (default 250). */
  timeoutMs?: number;
  /** Injected `setTimeout` so tests can use fake timers without polluting node globals. */
  setTimer?: (
    fn: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout> | number;
  /** Injected `clearTimeout` paired with `setTimer`. */
  clearTimer?: (timer: ReturnType<typeof setTimeout> | number) => void;
}

export function runQuitFlush(deps: QuitFlushDeps): void {
  const {
    on,
    off,
    send,
    onDone,
    timeoutMs = 250,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = deps;

  let sessionAcked = false;
  let assistantAcked = false;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | number | null = null;

  const finish = () => {
    if (done) return;
    done = true;
    off('to:session:save', onSessionAck);
    off('to:ai:conversations:flush', onAssistantAck);
    if (timer !== null) clearTimer(timer);
    onDone();
  };
  const tryFinish = () => {
    if (sessionAcked && assistantAcked) finish();
  };
  const onSessionAck = () => {
    sessionAcked = true;
    tryFinish();
  };
  const onAssistantAck = () => {
    assistantAcked = true;
    tryFinish();
  };

  on('to:session:save', onSessionAck);
  on('to:ai:conversations:flush', onAssistantAck);
  send('from:session:flush-request');
  send('from:ai:conversations:flush-request', null);
  timer = setTimer(finish, timeoutMs);
}
