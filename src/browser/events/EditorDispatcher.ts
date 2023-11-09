import { EditorSettings } from '../interfaces/Editor';
import { BaseDispatcher } from './Dispatcher';

export class EditorDispatcher extends BaseDispatcher {
  message ({ message }: { message: string }) {
    this.dispatchEvent({
      type: 'message',
      message: message
    });
  }

  setState ({ content }: { content: string }) {
    this.dispatchEvent({
      type: 'editor:state',
      message: content
    });
  }

  bridgeSettings ({ settings }: { settings: EditorSettings }) {
    this.dispatchEvent({
      type: 'editor:settings:bridge',
      message: settings
    });
  }
}