import type {
  Dispatcher,
  ListenerEvent,
  ListenerEventCallback,
} from '../interfaces/Dispatcher';
import { logger } from '../util';

export class BaseDispatcher implements Dispatcher {
  public listeners?: {
    [index: string]: Set<ListenerEventCallback>;
  };

  addEventListener(type: string, listener: ListenerEventCallback): void {
    if (this.listeners === undefined) this.listeners = {};
    const listeners = this.listeners;

    if (listeners[type] === undefined) {
      listeners[type] = new Set<ListenerEventCallback>();
    }

    listeners[type].add(listener);
  }

  hasEventListener(type: string, listener: ListenerEventCallback): boolean {
    if (this.listeners === undefined) return false;
    const listeners = this.listeners;
    return listeners[type] !== undefined && listeners[type].has(listener);
  }

  removeEventListener(type: string, listener: ListenerEventCallback): void {
    if (this.listeners === undefined) return;
    const listeners = this.listeners;
    const listenerSet = listeners[type];

    if (listenerSet !== undefined) {
      listenerSet.delete(listener);
    }
  }

  dispatchEvent(event: ListenerEvent): void {
    if (this.listeners === undefined) return;
    const listeners = this.listeners;
    const listenerSet = listeners[event.type];

    console.log({
      listeners,
      listenerSet,
      event,
    });

    logger?.info(
      'Renderer event dispatched',
      JSON.stringify({
        listeners,
        listenerSet,
        event,
      }),
    );

    if (listenerSet !== undefined) {
      event.target = this;

      // Snapshot to avoid iterator invalidation if the set is mutated
      const snapshot = Array.from(listenerSet);

      for (let i = 0, j = snapshot.length; i < j; ++i) {
        const cb = snapshot[i];
        // Guard against handlers removing handlers mid-dispatch
        if (!listenerSet.has(cb)) continue;
        cb.call(this, event);
      }
    }
  }
}
