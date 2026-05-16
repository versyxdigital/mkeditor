import { BaseDispatcher } from './Dispatcher';

/**
 * Phase 9 folded out `bridgeSettings` — settings/export-settings persist
 * through a registered handler on each provider now, not an event.
 * `editor:render` and `editor:track:content` remain because they have
 * cross-cutting React + manager consumers.
 */
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

  render() {
    this.dispatchEvent({
      type: 'editor:render',
      detail: undefined,
    });
  }
}
