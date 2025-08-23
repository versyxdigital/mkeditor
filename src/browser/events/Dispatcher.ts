import type {
  Dispatcher,
  ListenerEvent,
  ListenerEventCallback,
} from '../interfaces/Dispatcher';

export class BaseDispatcher implements Dispatcher {
  public _listeners?: {
    [index: string]: ListenerEventCallback[];
  };

  addEventListener(type: string, listener: ListenerEventCallback): void {
    if (this._listeners === undefined) this._listeners = {};
    const listeners = this._listeners;

    if (listeners[type] === undefined) {
      listeners[type] = [];
    }

    if (!listeners[type].includes(listener)) {
      listeners[type].push(listener);
    }
  }

  hasEventListener(type: string, listener: ListenerEventCallback): boolean {
    if (this._listeners === undefined) return false;
    const listeners = this._listeners;
    return listeners[type] !== undefined && listeners[type].includes(listener);
  }

  removeEventListener(type: string, listener: ListenerEventCallback): void {
    if (this._listeners === undefined) return;
    const listeners = this._listeners;
    const listenerA = listeners[type];

    if (listenerA !== undefined) {
      const index = listenerA.indexOf(listener);
      if (index !== -1) {
        listenerA.splice(index, 1);
      }
    }
  }

  dispatchEvent(event: ListenerEvent): void {
    if (this._listeners === undefined) return;
    const listeners = this._listeners;
    const listenerA = listeners[event.type];

    if (listenerA !== undefined) {
      event.target = this;

      const copy = listenerA.slice(0);

      for (let i = 0, j = copy.length; i < j; ++i) {
        copy[i].call(this, event);
      }
    }
  }
}
