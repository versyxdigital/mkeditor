import { BaseDispatcher } from './Dispatcher';

/**
 * `editor:render` and `editor:track:content` have cross-cutting
 * React + manager consumers.
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
