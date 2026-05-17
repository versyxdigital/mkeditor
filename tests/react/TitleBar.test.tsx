import * as React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TitleBar } from '../../src/browser/react/components/TitleBar';
import {
  ManagersProvider,
  type Managers,
} from '../../src/browser/react/contexts/ManagersContext';
import { WindowProvider } from '../../src/browser/react/contexts/WindowContext';
import { menuModel } from '../../src/app/lib/menuModel';
import { dispatchMenuActionExternal } from '../../src/browser/menuDispatch';

jest.mock('../../src/browser/menuDispatch', () => ({
  dispatchMenuActionExternal: jest.fn(),
  registerMenuActionDispatcher: jest.fn(),
}));

// i18next isn't initialised in tests — return the `defaultValue` (i.e.
// the model's English label) so accessible-name queries see real text.
jest.mock('../../src/browser/i18n', () => ({
  t: (_key: string, opts?: { defaultValue?: string }) =>
    opts?.defaultValue ?? _key,
  normalizeLanguage: (lng: string) => lng,
}));

// jsdom doesn't implement these — Radix dropdown shims around them when
// absent but logs noisy errors. Stubbing keeps the test output clean.
beforeAll(() => {
  Element.prototype.hasPointerCapture = jest.fn(() => false) as never;
  Element.prototype.scrollIntoView = jest.fn() as never;
});

function buildBridgeManager(initial = false) {
  let state = { isMaximized: initial };
  const listeners = new Set<() => void>();
  return {
    subscribeWindowState: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getWindowState: () => state,
    setWindowState: (next: typeof state) => {
      state = next;
      listeners.forEach((l) => l());
    },
    windowMinimize: jest.fn(),
    windowMaximize: jest.fn(),
    windowClose: jest.fn(),
    windowToggleFullscreen: jest.fn(),
    runCommand: jest.fn(),
  };
}

function renderTitleBar(
  opts: {
    mode?: 'desktop' | 'web';
    platform?: 'web' | 'darwin' | 'win32' | 'linux';
  } = {},
) {
  const bridge = buildBridgeManager();
  const mode = opts.mode ?? 'desktop';
  const managers = {
    mode,
    platform: opts.platform ?? (mode === 'web' ? 'web' : 'linux'),
    dispatcher: {} as any,
    editorManager: null,
    fileManager: null,
    fileTreeManager: null,
    bridgeManager: bridge as any,
    providers: {
      bridge: null,
      commands: null,
      completion: null,
      settings: null,
      exportSettings: null,
    },
  } as Managers;

  const utils = render(
    <ManagersProvider value={managers}>
      <WindowProvider>
        <TitleBar />
      </WindowProvider>
    </ManagersProvider>,
  );
  return { ...utils, bridge };
}

beforeEach(() => {
  (dispatchMenuActionExternal as jest.Mock).mockClear();
});

describe('<TitleBar>', () => {
  it('renders one trigger per MenuGroup', () => {
    renderTitleBar();
    for (const group of menuModel) {
      expect(
        screen.getByRole('button', { name: group.label }),
      ).toBeInTheDocument();
    }
  });

  it('opens a dropdown when its menu button is clicked and dispatches on item select', async () => {
    const user = userEvent.setup();
    renderTitleBar();
    await user.click(screen.getByRole('button', { name: 'File' }));

    const newItem = await screen.findByRole('menuitem', { name: /New File/ });
    expect(newItem).toBeInTheDocument();

    await user.click(newItem);
    expect(dispatchMenuActionExternal).toHaveBeenCalledTimes(1);
    expect(dispatchMenuActionExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'channel',
        channel: 'from:file:new',
      }),
    );
  });

  it('renders window-control buttons on desktop', () => {
    renderTitleBar({ mode: 'desktop' });
    expect(
      screen.getByRole('button', { name: 'Minimize' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Maximize' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('hides window-control buttons on web', () => {
    renderTitleBar({ mode: 'web' });
    expect(
      screen.queryByRole('button', { name: 'Minimize' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Close' }),
    ).not.toBeInTheDocument();
  });

  it('window-control clicks call BridgeManager methods', () => {
    const { bridge } = renderTitleBar();

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(bridge.windowMinimize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
    expect(bridge.windowMaximize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(bridge.windowClose).toHaveBeenCalledTimes(1);
  });

  it('maximize button label flips when isMaximized changes', () => {
    const { bridge } = renderTitleBar();
    expect(
      screen.getByRole('button', { name: 'Maximize' }),
    ).toBeInTheDocument();

    act(() => {
      bridge.setWindowState({ isMaximized: true });
    });

    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Maximize' }),
    ).not.toBeInTheDocument();
  });

  it('Edit menu items map to role actions', async () => {
    const user = userEvent.setup();
    renderTitleBar();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(await screen.findByRole('menuitem', { name: /Undo/ }));
    expect(dispatchMenuActionExternal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'role', role: 'undo' }),
    );
  });

  it('Help menu items map to from:modal:open with the right payload', async () => {
    const user = userEvent.setup();
    renderTitleBar();
    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(
      await screen.findByRole('menuitem', { name: /About MKEditor/ }),
    );
    expect(dispatchMenuActionExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'channel',
        channel: 'from:modal:open',
        payload: 'about',
      }),
    );
  });

  it('View > Toggle Developer Tools dispatches a command action', async () => {
    const user = userEvent.setup();
    renderTitleBar();
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(
      await screen.findByRole('menuitem', { name: /Toggle Developer Tools/ }),
    );
    expect(dispatchMenuActionExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'command',
        commandId: 'toggle-devtools',
      }),
    );
  });

  it('renders nothing on macOS desktop (native menu owns that surface)', () => {
    const { container } = renderTitleBar({
      mode: 'desktop',
      platform: 'darwin',
    });
    expect(screen.queryByTestId('title-bar' as never)).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('displays accelerators in the dropdown using Ctrl rather than CmdOrCtrl', async () => {
    const user = userEvent.setup();
    renderTitleBar();
    await user.click(screen.getByRole('button', { name: 'File' }));
    const newItem = await screen.findByRole('menuitem', { name: /New File/ });
    expect(within(newItem).getByText(/Ctrl\+N/)).toBeInTheDocument();
  });

  describe('keyboard navigation', () => {
    it('Alt focuses the first menu trigger', () => {
      renderTitleBar();
      // Dispatch on window directly — fireEvent.keyDown wraps an
      // Element dispatcher and the handler we're exercising is bound
      // to window.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' }));
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'File' }),
      );
    });

    it('ArrowRight on a focused trigger moves focus to the next trigger', () => {
      renderTitleBar();
      const file = screen.getByRole('button', { name: 'File' });
      const edit = screen.getByRole('button', { name: 'Edit' });
      file.focus();
      fireEvent.keyDown(file, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(edit);
    });

    it('ArrowLeft wraps to the last trigger from the first', () => {
      renderTitleBar();
      const file = screen.getByRole('button', { name: 'File' });
      const help = screen.getByRole('button', { name: 'Help' });
      file.focus();
      fireEvent.keyDown(file, { key: 'ArrowLeft' });
      expect(document.activeElement).toBe(help);
    });

    it('End jumps to the last trigger', () => {
      renderTitleBar();
      const file = screen.getByRole('button', { name: 'File' });
      const help = screen.getByRole('button', { name: 'Help' });
      file.focus();
      fireEvent.keyDown(file, { key: 'End' });
      expect(document.activeElement).toBe(help);
    });

    it('Home jumps to the first trigger', () => {
      renderTitleBar();
      const file = screen.getByRole('button', { name: 'File' });
      const help = screen.getByRole('button', { name: 'Help' });
      help.focus();
      fireEvent.keyDown(help, { key: 'Home' });
      expect(document.activeElement).toBe(file);
    });

    it('does not steal Alt while focus is in a contenteditable region', () => {
      renderTitleBar();
      const ce = document.createElement('div');
      // setAttribute (not the contentEditable property) is what closest()
      // attribute selectors actually inspect in jsdom — the property
      // sometimes doesn't reflect back into the attribute.
      ce.setAttribute('contenteditable', 'true');
      ce.tabIndex = 0;
      document.body.appendChild(ce);
      ce.focus();
      ce.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }),
      );
      expect(document.activeElement).toBe(ce);
      ce.remove();
    });

    it('does not steal Alt while the user is typing in an input', () => {
      renderTitleBar();
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      // Dispatch from the input so e.target is the input element.
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }),
      );
      // Focus did NOT jump to the File trigger.
      expect(document.activeElement).toBe(input);
      input.remove();
    });

    it('does not steal Alt on web (no menu nav)', () => {
      renderTitleBar({ mode: 'web', platform: 'web' });
      const file = screen.queryByRole('button', { name: 'File' });
      // No focus snap on web — verify by firing Alt and asserting the
      // active element didn't change.
      const before = document.activeElement;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' }));
      expect(document.activeElement).toBe(before);
      expect(file).toBeInTheDocument(); // File menu still rendered on web
    });
  });

  describe('double-click drag region', () => {
    it('toggles maximize on the title bar background', () => {
      const { bridge } = renderTitleBar();
      const bar = screen.getByTestId('title-bar');
      fireEvent.doubleClick(bar);
      expect(bridge.windowMaximize).toHaveBeenCalledTimes(1);
    });

    it('ignores double-clicks that originated on a no-drag child', () => {
      const { bridge } = renderTitleBar();
      const closeBtn = screen.getByRole('button', { name: 'Close' });
      fireEvent.doubleClick(closeBtn);
      expect(bridge.windowMaximize).not.toHaveBeenCalled();
    });

    it('is inert on web (no maximize concept)', () => {
      const { bridge } = renderTitleBar({ mode: 'web', platform: 'web' });
      const bar = screen.getByTestId('title-bar');
      fireEvent.doubleClick(bar);
      expect(bridge.windowMaximize).not.toHaveBeenCalled();
    });
  });
});
