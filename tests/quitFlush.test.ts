/**
 * `runQuitFlush` — main-process quit-flush orchestrator (P7).
 *
 * Drives the helper with hand-rolled `on`/`off`/`send`/`onDone` mocks
 * so we can control ack timing without spinning up Electron. The
 * production main.ts wires this with ipcMain + webContents +
 * app.quit; the unit tests cover the orchestration shape (both acks
 * arrive → onDone fires; timeout → onDone fires; subsequent acks
 * after onDone don't double-fire; listeners are torn down cleanly).
 */

import { runQuitFlush } from '../src/app/lib/quitFlush';

type AckChannel = 'to:session:save' | 'to:ai:conversations:flush';
type SendChannel =
  | 'from:session:flush-request'
  | 'from:ai:conversations:flush-request';

interface Harness {
  emit: (channel: AckChannel) => void;
  sent: Array<{ channel: SendChannel; payload: unknown }>;
  listenerCount: () => number;
  fireTimeout: () => void;
}

function makeHarness(): {
  deps: Parameters<typeof runQuitFlush>[0];
  onDone: jest.Mock;
  harness: Harness;
} {
  const onDone = jest.fn();
  const listeners = new Map<AckChannel, Set<() => void>>();
  const sent: Array<{ channel: SendChannel; payload: unknown }> = [];
  let timerFn: (() => void) | null = null;

  const harness: Harness = {
    emit: (channel) => {
      listeners.get(channel)?.forEach((l) => l());
    },
    sent,
    listenerCount: () => {
      let n = 0;
      for (const set of listeners.values()) n += set.size;
      return n;
    },
    fireTimeout: () => {
      timerFn?.();
    },
  };

  const deps: Parameters<typeof runQuitFlush>[0] = {
    on: (channel, listener) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
    },
    off: (channel, listener) => {
      listeners.get(channel)?.delete(listener);
    },
    send: (channel, payload) => {
      sent.push({ channel, payload });
    },
    onDone,
    setTimer: (fn) => {
      timerFn = fn;
      return 1;
    },
    clearTimer: () => {
      timerFn = null;
    },
  };

  return { deps, onDone, harness };
}

describe('runQuitFlush', () => {
  it('immediately broadcasts both flush-request notifications', () => {
    const { deps, harness } = makeHarness();
    runQuitFlush(deps);
    expect(harness.sent).toEqual([
      { channel: 'from:session:flush-request', payload: undefined },
      { channel: 'from:ai:conversations:flush-request', payload: null },
    ]);
  });

  it('subscribes to both ack channels (one listener each)', () => {
    const { deps, harness } = makeHarness();
    runQuitFlush(deps);
    expect(harness.listenerCount()).toBe(2);
  });

  it('fires onDone exactly once when BOTH acks arrive', () => {
    const { deps, onDone, harness } = makeHarness();
    runQuitFlush(deps);
    expect(onDone).not.toHaveBeenCalled();
    harness.emit('to:session:save');
    expect(onDone).not.toHaveBeenCalled(); // still waiting for the assistant ack
    harness.emit('to:ai:conversations:flush');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('order of acks does not matter (assistant first, then session also resolves)', () => {
    const { deps, onDone, harness } = makeHarness();
    runQuitFlush(deps);
    harness.emit('to:ai:conversations:flush');
    expect(onDone).not.toHaveBeenCalled();
    harness.emit('to:session:save');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('fires onDone via the safety timeout when an ack never arrives', () => {
    const { deps, onDone, harness } = makeHarness();
    runQuitFlush(deps);
    harness.emit('to:session:save');
    // Assistant ack never arrives — timeout rescues the quit.
    harness.fireTimeout();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('removes both ack listeners after onDone fires (no leaks)', () => {
    const { deps, harness } = makeHarness();
    runQuitFlush(deps);
    harness.emit('to:session:save');
    harness.emit('to:ai:conversations:flush');
    expect(harness.listenerCount()).toBe(0);
  });

  it('a late-arriving ack after onDone has fired does not re-fire onDone', () => {
    // Race: timeout finished us, then the renderer's ack finally
    // lands. Listener has been removed; even if it could fire, the
    // `done` latch would prevent double-onDone.
    const { deps, onDone, harness } = makeHarness();
    runQuitFlush(deps);
    harness.fireTimeout();
    expect(onDone).toHaveBeenCalledTimes(1);
    // Listeners were torn down — no later emit can reach them.
    harness.emit('to:session:save');
    harness.emit('to:ai:conversations:flush');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('respects a custom timeoutMs by calling setTimer with that value', () => {
    const customSetTimer = jest.fn(() => 99);
    runQuitFlush({
      on: jest.fn(),
      off: jest.fn(),
      send: jest.fn(),
      onDone: jest.fn(),
      timeoutMs: 1000,
      setTimer: customSetTimer,
      clearTimer: jest.fn(),
    });
    expect(customSetTimer).toHaveBeenCalledWith(expect.any(Function), 1000);
  });
});
