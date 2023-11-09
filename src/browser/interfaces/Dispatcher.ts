export interface Dispatcher {
  _listeners?: {
    [index: string]: ListenerEventCallback[];
  };

  addEventListener(type: string, listener: ListenerEventCallback) : void;
  hasEventListener(type: string, listener: ListenerEventCallback) : boolean;
  removeEventListener(type: string, listener: ListenerEventCallback) : void;
  dispatchEvent(event: ListenerEvent) : void;
}

export interface ListenerEvent {
  target?: Dispatcher;
  type: string;
  message: any;
}

export type ListenerEventCallback = ((event: ListenerEvent) => any);