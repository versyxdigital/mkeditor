import { EditorSettings } from '../interfaces/Editor';
import { BaseDispatcher } from './Dispatcher';

export class EditorDispatcher extends BaseDispatcher {
  message({ message }: { message: string }) {
    this.dispatchEvent({
      type: 'message',
      message: message,
    });
  }

  setTrackedContent({ content }: { content: string }) {
    this.dispatchEvent({
      type: 'editor:track:content',
      message: content,
    });
  }

  updateCompletionProvider({ matcher }: { matcher: string }) {
    this.dispatchEvent({
      type: 'editor:completion:load',
      message: matcher,
    });
  }

  bridgeSettings({ settings }: { settings: EditorSettings }) {
    this.dispatchEvent({
      type: 'editor:bridge:settings',
      message: settings,
    });
  }

  render() {
    this.dispatchEvent({
      type: 'editor:render',
      message: undefined,
    });
  }
}
