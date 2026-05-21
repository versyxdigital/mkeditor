/**
 * <InlineDiffPreview> unit tests.
 *
 * The component wraps Monaco's `createDiffEditor` so the chat's
 * tool-confirmation card can show a unified diff inline. Tests
 * stub Monaco's diff editor + model factories so we can assert:
 *   - editor + both models are constructed at mount
 *   - dispose order is editor-first, then models, on unmount
 *   - the side-by-side toggle calls `updateOptions({renderSideBySide})`
 *     in place (no remount)
 *   - prop changes flow through `setValue` on the existing models
 *     (also no remount)
 *
 * Mock strategy: provide our own `monaco-editor` mock that records
 * every interaction. Sibling tests use the default mock from
 * `tests/__mocks__/monaco-editor.js`, which doesn't expose
 * `createDiffEditor` — so this file overrides per-test.
 */

import * as React from 'react';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';

import { PREVIEW_TRUNCATION_MARKER } from '../../src/browser/core/AssistantTools';

interface MockModel {
  __id: string;
  value: string;
  getValue: () => string;
  setValue: jest.Mock;
  dispose: jest.Mock;
}

interface MockDiffEditor {
  __setModel: jest.Mock;
  __updateOptions: jest.Mock;
  __dispose: jest.Mock;
  __disposedBefore: { models: number };
  setModel: (m: { original: MockModel; modified: MockModel }) => void;
  updateOptions: (o: { renderSideBySide?: boolean }) => void;
  dispose: () => void;
}

const models: MockModel[] = [];
const diffEditors: MockDiffEditor[] = [];

jest.mock('monaco-editor', () => {
  return {
    editor: {
      createModel: jest.fn((value: string) => {
        const m: MockModel = {
          __id: `model-${models.length}`,
          value,
          getValue: () => m.value,
          setValue: jest.fn((next: string) => {
            m.value = next;
          }),
          dispose: jest.fn(),
        };
        models.push(m);
        return m;
      }),
      createDiffEditor: jest.fn(() => {
        const setModel = jest.fn();
        const updateOptions = jest.fn();
        const dispose = jest.fn();
        let modelsDisposedBefore = 0;
        const editor: MockDiffEditor = {
          __setModel: setModel,
          __updateOptions: updateOptions,
          __dispose: dispose,
          __disposedBefore: {
            get models() {
              return modelsDisposedBefore;
            },
          } as unknown as { models: number },
          setModel,
          updateOptions,
          dispose: () => {
            // Snapshot how many models had already been disposed at
            // the moment the editor's dispose runs — should be 0
            // (editor-first ordering).
            modelsDisposedBefore = models.filter(
              (m) => m.dispose.mock.calls.length > 0,
            ).length;
            dispose();
          },
        };
        diffEditors.push(editor);
        return editor;
      }),
      setTheme: jest.fn(),
      create: jest.fn(),
    },
    languages: { registerCompletionItemProvider: jest.fn() },
    KeyMod: { CtrlCmd: 0, Shift: 0, Alt: 0, WinCtrl: 0, chord: () => 0 },
    KeyCode: new Proxy({}, { get: () => 0 }),
  };
});

jest.mock('../../src/browser/react/contexts/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      // The component only reads `effectiveDarkmode`; everything else
      // is ignored. False here so the test runs against the `vs`
      // theme.
      effectiveDarkmode: false,
    },
    updateSetting: jest.fn(),
  }),
}));

jest.mock('../../src/browser/react/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

import { InlineDiffPreview } from '../../src/browser/react/components/assistant/InlineDiffPreview';

beforeEach(() => {
  models.length = 0;
  diffEditors.length = 0;
});

describe('<InlineDiffPreview>', () => {
  it('creates a diff editor with two models on mount', () => {
    render(<InlineDiffPreview original="line one" modified="line ONE" />);
    expect(models).toHaveLength(2);
    expect(models[0].getValue()).toBe('line one');
    expect(models[1].getValue()).toBe('line ONE');
    expect(diffEditors).toHaveLength(1);
    expect(diffEditors[0].__setModel).toHaveBeenCalledTimes(1);
    expect(diffEditors[0].__setModel).toHaveBeenCalledWith({
      original: models[0],
      modified: models[1],
    });
  });

  it('defaults to unified rendering (renderSideBySide: false)', () => {
    render(<InlineDiffPreview original="a" modified="b" />);
    const opts =
      (diffEditors[0].__setModel as jest.Mock).mock.calls[0]?.[0] ?? null;
    expect(opts).toBeTruthy();
    // The create call carries `renderSideBySide: false` in its options
    // argument (second positional). Grab the mocked createDiffEditor.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const monaco = require('monaco-editor');
    const createOpts = monaco.editor.createDiffEditor.mock.calls[0][1];
    expect(createOpts.renderSideBySide).toBe(false);
  });

  it('toggle button recreates the diff editor with the flipped renderSideBySide option', () => {
    // Monaco 0.55's IDiffEditor.updateOptions({renderSideBySide}) doesn't
    // reliably flip the render mode at runtime — the editor honours
    // the value supplied at createDiffEditor time. Editor + models
    // are torn down and rebuilt as a single unit on toggle (single
    // useEffect so cleanup runs editor-first then models, matching
    // Monaco's required dispose ordering).
    render(<InlineDiffPreview original="a" modified="b" />);
    expect(diffEditors).toHaveLength(1);
    expect(models).toHaveLength(2);
    const toggle = screen.getByTestId('inline-diff-side-by-side-toggle');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const monaco = require('monaco-editor');

    fireEvent.click(toggle);
    expect(diffEditors).toHaveLength(2);
    // Last createDiffEditor call carries renderSideBySide: true.
    const lastCall =
      monaco.editor.createDiffEditor.mock.calls[
        monaco.editor.createDiffEditor.mock.calls.length - 1
      ];
    expect(lastCall[1].renderSideBySide).toBe(true);
    // Models are recreated too (single combined lifecycle). Newest
    // pair carries the same content.
    expect(models).toHaveLength(4);
    expect(models[2].getValue()).toBe('a');
    expect(models[3].getValue()).toBe('b');
    expect(diffEditors[1].__setModel).toHaveBeenCalledWith({
      original: models[2],
      modified: models[3],
    });
    // The previous editor's pair was disposed before the new editor
    // got built.
    expect(models[0].dispose).toHaveBeenCalled();
    expect(models[1].dispose).toHaveBeenCalled();
    expect(diffEditors[0].__dispose).toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(diffEditors).toHaveLength(3);
    const lastCall2 =
      monaco.editor.createDiffEditor.mock.calls[
        monaco.editor.createDiffEditor.mock.calls.length - 1
      ];
    expect(lastCall2[1].renderSideBySide).toBe(false);
  });

  it('disables line numbers + glyph margin so the gutter does not eat the narrow chat panel', () => {
    render(<InlineDiffPreview original="a" modified="b" />);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const monaco = require('monaco-editor');
    const opts = monaco.editor.createDiffEditor.mock.calls[0][1];
    expect(opts.lineNumbers).toBe('off');
    expect(opts.glyphMargin).toBe(false);
  });

  it('prop changes flow through model setValue without recreating the editor', () => {
    const { rerender } = render(
      <InlineDiffPreview original="old" modified="new" />,
    );
    expect(diffEditors).toHaveLength(1);
    rerender(<InlineDiffPreview original="OLD2" modified="NEW2" />);
    expect(models[0].setValue).toHaveBeenCalledWith('OLD2');
    expect(models[1].setValue).toHaveBeenCalledWith('NEW2');
    // Same editor, no second createDiffEditor call.
    expect(diffEditors).toHaveLength(1);
  });

  it('disposes the editor first, then both models, on unmount', () => {
    const { unmount } = render(<InlineDiffPreview original="a" modified="b" />);
    const editor = diffEditors[0];
    const [originalModel, modifiedModel] = models;

    unmount();

    expect(editor.__dispose).toHaveBeenCalledTimes(1);
    expect(originalModel.dispose).toHaveBeenCalledTimes(1);
    expect(modifiedModel.dispose).toHaveBeenCalledTimes(1);
    // The editor wrapper records how many models had been disposed
    // at the moment editor.dispose() ran — must be zero for the
    // editor-first contract.
    expect(editor.__disposedBefore.models).toBe(0);
  });

  it('survives an already-disposed model (try/catch wraps each dispose)', () => {
    const { unmount } = render(<InlineDiffPreview original="a" modified="b" />);
    // Simulate Monaco having already torn down one model (rare, but
    // happens if a parent component disposes models out-of-band).
    models[0].dispose.mockImplementationOnce(() => {
      throw new Error('already disposed');
    });
    expect(() => unmount()).not.toThrow();
  });

  it('shows no expander when neither side is truncated', () => {
    render(<InlineDiffPreview original="a" modified="b" />);
    expect(screen.queryByTestId('inline-diff-expand-toggle')).toBeNull();
  });

  it('shows no expander when truncated but no fetcher prop supplied', () => {
    render(
      <InlineDiffPreview
        original={`head${PREVIEW_TRUNCATION_MARKER}`}
        modified="short"
      />,
    );
    expect(screen.queryByTestId('inline-diff-expand-toggle')).toBeNull();
  });

  it('expand button fetches both sides in parallel and pushes full content into the models', async () => {
    const truncatedOrig = `orig-head${PREVIEW_TRUNCATION_MARKER}`;
    const truncatedMod = `mod-head${PREVIEW_TRUNCATION_MARKER}`;
    const fetchFullOriginal = jest.fn(() => Promise.resolve('orig-FULL'));
    const fetchFullModified = jest.fn(() => Promise.resolve('mod-FULL'));

    render(
      <InlineDiffPreview
        original={truncatedOrig}
        modified={truncatedMod}
        fetchFullOriginal={fetchFullOriginal}
        fetchFullModified={fetchFullModified}
      />,
    );

    const expandToggle = screen.getByTestId('inline-diff-expand-toggle');
    expect(expandToggle.textContent).toBe('assistant-tools:preview_show_full');

    await act(async () => {
      fireEvent.click(expandToggle);
    });

    await waitFor(() => {
      expect(fetchFullOriginal).toHaveBeenCalledTimes(1);
      expect(fetchFullModified).toHaveBeenCalledTimes(1);
    });

    // Models should have been setValue'd to the full content via the
    // data-update effect. Inspect mock setValue calls.
    expect(models[0].setValue).toHaveBeenCalledWith('orig-FULL');
    expect(models[1].setValue).toHaveBeenCalledWith('mod-FULL');
    expect(screen.getByTestId('inline-diff-expand-toggle').textContent).toBe(
      'assistant-tools:preview_show_less',
    );
  });

  it('expand button skips fetcher for an untruncated side', async () => {
    const fetchFullOriginal = jest.fn();
    const fetchFullModified = jest.fn(() => Promise.resolve('mod-FULL'));

    render(
      <InlineDiffPreview
        original="orig is fine"
        modified={`mod-head${PREVIEW_TRUNCATION_MARKER}`}
        fetchFullOriginal={fetchFullOriginal}
        fetchFullModified={fetchFullModified}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('inline-diff-expand-toggle'));
    });

    await waitFor(() => {
      expect(fetchFullModified).toHaveBeenCalledTimes(1);
    });
    expect(fetchFullOriginal).not.toHaveBeenCalled();
    expect(models[1].setValue).toHaveBeenCalledWith('mod-FULL');
  });

  it('collapse + re-expand uses cached full content (no second fetch)', async () => {
    const truncatedOrig = `o${PREVIEW_TRUNCATION_MARKER}`;
    const truncatedMod = `m${PREVIEW_TRUNCATION_MARKER}`;
    const fetchFullOriginal = jest.fn(() => Promise.resolve('OFULL'));
    const fetchFullModified = jest.fn(() => Promise.resolve('MFULL'));

    render(
      <InlineDiffPreview
        original={truncatedOrig}
        modified={truncatedMod}
        fetchFullOriginal={fetchFullOriginal}
        fetchFullModified={fetchFullModified}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('inline-diff-expand-toggle'));
    });
    await waitFor(() => {
      expect(fetchFullOriginal).toHaveBeenCalledTimes(1);
      expect(fetchFullModified).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('inline-diff-expand-toggle'));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('inline-diff-expand-toggle'));
    });

    // Still exactly one call each — cache reused.
    expect(fetchFullOriginal).toHaveBeenCalledTimes(1);
    expect(fetchFullModified).toHaveBeenCalledTimes(1);
  });
});
