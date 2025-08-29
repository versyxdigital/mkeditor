import type { SettingsFile } from '../interfaces/Editor';
import { BaseDispatcher } from './Dispatcher';

export class EditorDispatcher extends BaseDispatcher {
  message({ detail }: { detail: string }) {
    this.dispatchEvent({
      type: 'message',
      detail,
    });
  }

  setTrackedContent({ content }: { content: string }) {
    this.dispatchEvent({
      type: 'editor:track:content',
      detail: content,
    });
  }

  updateCompletionProvider({ matcher }: { matcher: string }) {
    this.dispatchEvent({
      type: 'editor:completion:load',
      detail: matcher,
    });
  }

  bridgeSettings({ settings }: { settings: Partial<SettingsFile> }) {
    this.dispatchEvent({
      type: 'editor:bridge:settings',
      detail: settings,
    });
  }

  render() {
    this.dispatchEvent({
      type: 'editor:render',
      detail: undefined,
    });
  }
}
