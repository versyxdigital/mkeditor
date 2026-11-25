import { editor } from 'monaco-editor';
import { EditorManager } from '../src/browser/core/EditorManager';
import { EditorDispatcher } from '../src/browser/events/EditorDispatcher';
import { logger } from '../src/browser/util';

jest.mock('monaco-editor', () => ({
  editor: { create: jest.fn() },
  KeyCode: { Enter: 3 },
}));
jest.mock('../src/browser/assets/intro', () => ({
  welcomeMarkdown: '# Welcome',
}));
jest.mock('../src/browser/extensions/editor/ScrollSync', () => ({
  ScrollSync: jest.fn(),
}));
jest.mock('../src/browser/util', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function makeEditor() {
  const subscriptions: Array<{ dispose: jest.Mock }> = [];
  let change!: (event: { changes: Array<{ text: string }> }) => void;
  const subscribe = () => {
    const disposable = { dispose: jest.fn() };
    subscriptions.push(disposable);
    return disposable;
  };
  return {
    change: (changes = [{ text: 'a' }]) => change({ changes }),
    subscriptions,
    api: {
      getValue: jest.fn(() => '# Changed'),
      onKeyDown: jest.fn(subscribe),
      onDidChangeModelContent: jest.fn((callback) => {
        change = callback;
        return subscribe();
      }),
      onDidScrollChange: jest.fn(subscribe),
      layout: jest.fn(),
      dispose: jest.fn(),
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = '<div id="editor"></div>';
  jest.clearAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
});

function setup() {
  const fake = makeEditor();
  (editor.create as jest.Mock).mockReturnValue(fake.api);
  const dispatcher = new EditorDispatcher();
  const render = jest.spyOn(dispatcher, 'render');
  const manager = new EditorManager({ dispatcher });
  manager.create({ mount: document.querySelector('#editor'), watch: true });
  render.mockClear();
  return { fake, dispatcher, render, manager };
}

describe('editor update scheduling and lifecycle', () => {
  it('coalesces typing bursts into bounded preview work without starving continuous typing', () => {
    const { fake, render, manager } = setup();
    for (let index = 0; index < 50; index++) fake.change();
    jest.advanceTimersByTime(149);
    expect(render).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(render).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 50; index++) fake.change();
    jest.advanceTimersByTime(150);
    expect(render).toHaveBeenCalledTimes(2);
    manager.dispose();
  });

  it('cancels pending preview and bridge updates when the editor is disposed', () => {
    const { fake, render, manager } = setup();
    const bridge = { sendFileContentHasChanged: jest.fn() };
    manager.provide('bridge', bridge);
    fake.change();
    manager.dispose();
    jest.advanceTimersByTime(1000);
    expect(render).not.toHaveBeenCalled();
    expect(bridge.sendFileContentHasChanged).not.toHaveBeenCalled();
    expect(fake.api.dispose).toHaveBeenCalledTimes(1);
    for (const subscription of fake.subscriptions)
      expect(subscription.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not register duplicate watchers when watch is called twice', () => {
    const { fake, manager } = setup();
    manager.watch();
    expect(fake.api.onDidChangeModelContent).toHaveBeenCalledTimes(1);
    expect(fake.api.onKeyDown).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it('handles empty Monaco change batches without crashing completion handling', () => {
    const { fake, manager } = setup();
    const completion = {
      autoContinueListMarkers: jest.fn(),
      suggestOnValidInput: jest.fn(),
      dispose: jest.fn(),
    };
    manager.provide('completion', completion);
    expect(() => fake.change([])).not.toThrow();
    expect(completion.suggestOnValidInput).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('cleans tracked-content and resize listeners and composition-owned resources', () => {
    const { fake, dispatcher, manager } = setup();
    const cleanup = jest.fn();
    manager.registerCleanup(cleanup);
    expect(dispatcher.listeners?.['editor:track:content'].size).toBe(1);
    window.dispatchEvent(new Event('resize'));
    expect(fake.api.layout).toHaveBeenCalledTimes(1);
    manager.dispose();
    window.dispatchEvent(new Event('resize'));
    expect(fake.api.layout).toHaveBeenCalledTimes(1);
    expect(dispatcher.listeners?.['editor:track:content'].size).toBe(0);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('continues teardown when one composition-owned resource throws', () => {
    const { manager, fake } = setup();
    const finalCleanup = jest.fn();
    manager.registerCleanup(() => {
      throw new Error('already disposed');
    });
    manager.registerCleanup(finalCleanup);
    expect(() => manager.dispose()).not.toThrow();
    expect(finalCleanup).toHaveBeenCalledTimes(1);
    expect(fake.api.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('dispatcher boundaries', () => {
  it.each(['constructor', '__proto__', 'toString'])(
    'supports event names inherited by plain objects: %s',
    (type) => {
      const dispatcher = new EditorDispatcher();
      const listener = jest.fn();
      dispatcher.addEventListener(type, listener);
      dispatcher.dispatchEvent({ type, detail: 'payload' });
      expect(listener).toHaveBeenCalledTimes(1);
      dispatcher.removeEventListener(type, listener);
      expect(dispatcher.hasEventListener(type, listener)).toBe(false);
    },
  );

  it('does not serialize or log document content on the dispatch hot path', () => {
    const dispatcher = new EditorDispatcher();
    dispatcher.addEventListener('editor:track:content', jest.fn());
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() =>
      dispatcher.dispatchEvent({
        type: 'editor:track:content',
        detail: circular,
      }),
    ).not.toThrow();
    expect(logger.debug).toHaveBeenLastCalledWith('Renderer event dispatch', {
      type: 'editor:track:content',
    });
  });
});
