import type { ExportSettings, SettingsFile } from '../interfaces/Editor';
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

  bridgeSettings({ settings }: { settings: Partial<SettingsFile> }) {
    this.dispatchEvent({
      type: 'editor:bridge:settings',
      message: settings,
    });
  }

  updatePreviewFromExportConfig({ settings }: { settings: ExportSettings }) {
    this.dispatchEvent({
      type: 'editor:preview:update-config',
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
