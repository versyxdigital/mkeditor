import * as React from 'react';
import { act } from '@testing-library/react';

import { PreviewPane } from '../../src/browser/react/components/PreviewPane';
import { renderWithProviders, fakeDispatcher } from '../utils/render';

// Stub the markdown renderer + ScrollSync helper so we exercise the
// dispatch-→-innerHTML wiring without depending on markdown-it / KaTeX
// /highlight.js being available in jsdom.
jest.mock('../../src/browser/core/Markdown', () => ({
  Markdown: {
    render: jest.fn((src: string) => `<rendered>${src}</rendered>`),
  },
}));

jest.mock('../../src/browser/extensions/editor/ScrollSync', () => ({
  ScrollSync: jest.fn(),
  refreshLines: jest.fn(),
}));

describe('<PreviewPane>', () => {
  it('renders the initial markdown immediately (catch-up render)', () => {
    const dispatcher = fakeDispatcher();
    const editorManager = {
      getValue: jest.fn(() => '# Hello'),
      getMkEditor: jest.fn(),
      layout: jest.fn(),
      resetContent: jest.fn(),
      providers: {} as any,
    };

    const { container } = renderWithProviders(<PreviewPane />, {
      managers: {
        dispatcher: dispatcher as any,
        editorManager: editorManager as any,
      },
    });

    const content = container.querySelector('#preview-content');
    // PreviewPane's useEffect calls `handler()` once for the catch-up
    // render so the initial markdown shows up without waiting for an
    // `editor:render` event.
    expect(content?.innerHTML).toBe('<rendered># Hello</rendered>');
  });

  it('re-renders the preview when the dispatcher fires editor:render', () => {
    const dispatcher = fakeDispatcher();
    let value = '# v1';
    const editorManager = {
      getValue: jest.fn(() => value),
      getMkEditor: jest.fn(),
      layout: jest.fn(),
      resetContent: jest.fn(),
      providers: {} as any,
    };

    const { container } = renderWithProviders(<PreviewPane />, {
      managers: {
        dispatcher: dispatcher as any,
        editorManager: editorManager as any,
      },
    });

    const content = container.querySelector('#preview-content');
    expect(content?.innerHTML).toBe('<rendered># v1</rendered>');

    // Mutate the value the manager returns and dispatch — the pane
    // should re-render with the new content.
    value = '# v2';
    act(() => {
      dispatcher.render();
    });

    expect(content?.innerHTML).toBe('<rendered># v2</rendered>');
  });
});
