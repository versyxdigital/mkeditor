export interface Dispatcher {
  _listeners?: {
    [index: string]: Set<ListenerEventCallback>;
  };

  addEventListener(type: string, listener: ListenerEventCallback): void;
  hasEventListener(type: string, listener: ListenerEventCallback): boolean;
  removeEventListener(type: string, listener: ListenerEventCallback): void;
  dispatchEvent(event: ListenerEvent): void;
}

export interface ListenerEvent {
  target?: Dispatcher;
  type: string;
  detail: any;
}

export type ListenerEventCallback = (event: ListenerEvent) => any;
