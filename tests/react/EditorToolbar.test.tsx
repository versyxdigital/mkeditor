import * as React from 'react';
import { screen, fireEvent } from '@testing-library/react';

import { EditorToolbar } from '../../src/browser/react/components/EditorToolbar';
import { renderWithProviders } from '../utils/render';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,
  normalizeLanguage: (lng: string) => lng,
  getAvailableLocales: jest.fn(async () => []),
}));

// EditorToolbar renders via createPortal into `#editor-functions`; seed
// that element in the document before each test so the portal mounts.
beforeEach(() => {
  const host = document.createElement('div');
  host.id = 'editor-functions';
  document.body.appendChild(host);
});

afterEach(() => {
  const host = document.getElementById('editor-functions');
  host?.remove();
});

function fakeCommandProvider() {
  return {
    editInline: jest.fn(),
    unorderedList: jest.fn(),
    orderedList: jest.fn(),
    table: jest.fn(),
    codeblock: jest.fn(),
    alert: jest.fn(),
    setOpenDropdown: jest.fn(),
  };
}

function fakeEditorManager() {
  const monaco = { focus: jest.fn() };
  return {
    getMkEditor: jest.fn(() => monaco),
    getValue: jest.fn(() => ''),
    layout: jest.fn(),
    resetContent: jest.fn(),
    providers: {
      bridge: null,
      commands: null,
      completion: null,
      settings: null,
      exportSettings: null,
    },
  };
}

describe('<EditorToolbar>', () => {
  const workspaceGroupRef = React.createRef<{
    setLayout: (sizes: Record<string, number>) => void;
  }>();

  it('the bold button calls CommandProvider.editInline with `**`', () => {
    const commands = fakeCommandProvider();
    const editorManager = fakeEditorManager();

    renderWithProviders(
      <EditorToolbar workspaceGroupRef={workspaceGroupRef as any} />,
      {
        managers: {
          editorManager: editorManager as any,
          providers: {
            bridge: null,
            completion: null,
            settings: null,
            exportSettings: null,
            commands: commands as any,
          },
        },
      },
    );

    fireEvent.click(screen.getByTitle('toolbar:bold_tooltip'));
    expect(commands.editInline).toHaveBeenCalledWith('**');
  });

  it('the unordered-list button calls CommandProvider.unorderedList', () => {
    const commands = fakeCommandProvider();
    const editorManager = fakeEditorManager();

    renderWithProviders(
      <EditorToolbar workspaceGroupRef={workspaceGroupRef as any} />,
      {
        managers: {
          editorManager: editorManager as any,
          providers: {
            bridge: null,
            completion: null,
            settings: null,
            exportSettings: null,
            commands: commands as any,
          },
        },
      },
    );

    fireEvent.click(screen.getByTitle('toolbar:unordered_list_tooltip'));
    expect(commands.unorderedList).toHaveBeenCalled();
  });

  it('the reset-split button calls setLayout on the workspace Group ref', () => {
    const commands = fakeCommandProvider();
    const editorManager = fakeEditorManager();
    const setLayout = jest.fn();
    const ref = { current: { setLayout } };

    renderWithProviders(<EditorToolbar workspaceGroupRef={ref as any} />, {
      managers: {
        editorManager: editorManager as any,
        providers: {
          bridge: null,
          completion: null,
          settings: null,
          exportSettings: null,
          commands: commands as any,
        },
      },
    });

    fireEvent.click(screen.getByTitle('toolbar:reset_split'));
    expect(setLayout).toHaveBeenCalledWith({
      'editor-pane': 50,
      'preview-pane': 50,
    });
  });

  it('registers itself as the CommandProvider dropdown opener on mount', () => {
    const commands = fakeCommandProvider();
    const editorManager = fakeEditorManager();

    renderWithProviders(
      <EditorToolbar workspaceGroupRef={workspaceGroupRef as any} />,
      {
        managers: {
          editorManager: editorManager as any,
          providers: {
            bridge: null,
            completion: null,
            settings: null,
            exportSettings: null,
            commands: commands as any,
          },
        },
      },
    );

    expect(commands.setOpenDropdown).toHaveBeenCalledWith(expect.any(Function));
  });
});
