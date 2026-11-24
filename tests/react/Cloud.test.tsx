import * as React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CloudConnections } from '../../src/browser/react/components/cloud/CloudConnections';
import { CloudExplorer } from '../../src/browser/react/components/cloud/CloudExplorer';
import { Navbar } from '../../src/browser/react/components/Navbar';
import { Sidebar } from '../../src/browser/react/components/Sidebar';
import { RemoteDocumentNotice } from '../../src/browser/react/components/cloud/RemoteDocumentNotice';
import { RemoteDocumentMenu } from '../../src/browser/react/components/cloud/RemoteDocumentMenu';
import { CloudManager } from '../../src/browser/core/CloudManager';
import type {
  CloudState,
  RemoteDocument,
} from '../../src/app/interfaces/Cloud';
import { renderWithProviders, fakeFileManager } from '../utils/render';
import { registerPromptOpener } from '../../src/browser/prompts';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,
  normalizeLanguage: () => 'en',
}));
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: jest.fn(),
  });
});
function setup(connected = true) {
  const listeners = new Map<string, (value: never) => void>();
  const bridge = {
    send: jest.fn(),
    receive: (channel: string, fn: (value: never) => void) => {
      listeners.set(channel, fn);
    },
  };
  const manager = new CloudManager(bridge, {} as never);
  const state: CloudState = {
    revision: 1,
    secureStorage: true,
    googleDriveAvailable: true,
    connections: [
      {
        id: 'drive',
        name: 'Personal Drive',
        clientId: 'example.apps.googleusercontent.com',
        clientValue: '',
        accountName: connected ? 'user@example.test' : undefined,
        accountId: connected ? 'account' : undefined,
        status: connected ? 'connected' : 'disconnected',
      },
    ],
  };
  const push = (next = state) =>
    act(() => listeners.get('from:cloud:state')!(next as never));
  push();
  return {
    manager,
    bridge,
    push,
    state,
    listeners,
    managers: {
      mode: 'desktop' as const,
      bridgeManager: { cloudManager: manager } as never,
    },
  };
}

test('storage selector lives after the toolbar menu, outside Explorer, and switches workspace', async () => {
  const { manager, managers } = setup();
  manager.selectWorkspace('drive');
  renderWithProviders(
    <>
      <Navbar />
      <Sidebar />
    </>,
    { managers },
  );
  const picker = within(screen.getByRole('navigation')).getByRole('combobox', {
    name: 'cloud:workspace',
  });
  expect(picker).toHaveTextContent('Personal Drive');
  expect(
    screen.getByRole('button', { name: 'navbar:toggle_sidebar' })
      .nextElementSibling,
  ).toBe(picker);
  expect(picker.nextElementSibling).toHaveAttribute('id', 'active-file');
  expect(
    within(document.getElementById('sidebar')!).queryByRole('combobox'),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('user@example.test')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'cloud:manage' }),
  ).not.toBeInTheDocument();
  expect(
    document.querySelector('img[src="./google-drive.png"]'),
  ).toBeInTheDocument();
  const user = userEvent.setup();
  picker.focus();
  await user.keyboard('{ArrowDown}');
  expect(await screen.findByText('user@example.test')).toBeInTheDocument();
  expect(
    screen.getByRole('option', { name: /cloud:manage/ }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: /cloud:local/ }));
  expect(manager.getSnapshot().workspace).toBe('local');
  expect(picker).toHaveTextContent('cloud:local');
  act(() => manager.dispose());
});

test('web toolbar hides the storage selector even with a configured cloud manager', () => {
  const { manager, managers } = setup();
  renderWithProviders(<Navbar />, { managers: { ...managers, mode: 'web' } });
  expect(
    screen.queryByRole('combobox', { name: 'cloud:workspace' }),
  ).not.toBeInTheDocument();
  act(() => manager.dispose());
});

test('new-file and copy actions are keyboard accessible without a visible button strip', async () => {
  const { manager, managers } = setup();
  manager.selectWorkspace('drive');
  jest.spyOn(manager, 'canCreate').mockReturnValue(true);
  const create = jest.spyOn(manager, 'create').mockResolvedValue();
  const files = fakeFileManager({
    activeFile: '/notes.md',
    tabs: [{ path: '/notes.md', name: 'notes.md' }],
  });
  renderWithProviders(<CloudExplorer />, {
    managers: { ...managers, fileManager: files as never },
  });
  expect(screen.queryByText('cloud:new_file')).not.toBeInTheDocument();
  expect(screen.queryByText('cloud:save_copy')).not.toBeInTheDocument();
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'cloud:new_file' }).focus();
  await user.keyboard('{Enter}');
  expect(create).toHaveBeenCalledWith();
  screen.getByRole('button', { name: 'cloud:actions' }).focus();
  await user.keyboard('{Enter}');
  await user.click(
    await screen.findByRole('menuitem', { name: 'cloud:save_copy' }),
  );
  expect(create).toHaveBeenLastCalledWith(true);
  act(() => manager.dispose());
});

test('opening a Drive file shows row progress and restores the row after a failed download', async () => {
  const { manager, managers, bridge, listeners, state } = setup();
  manager.selectWorkspace('drive');
  renderWithProviders(<CloudExplorer />, { managers });
  expect(screen.getByRole('status')).toHaveTextContent('cloud:loading');
  const listing = bridge.send.mock.calls.find(
    (call) => call[1].command.action === 'list',
  )![1];
  const item = { id: 'intro', name: 'Intro.md', kind: 'markdown', parents: [] };
  await act(async () =>
    listeners.get('from:cloud:result')!({
      requestId: listing.requestId,
      ok: true,
      state,
      page: { items: [item] },
    } as never),
  );
  const row = screen.getByRole('button', { name: 'Intro.md' });
  fireEvent.click(row);
  expect(row).toHaveAttribute('aria-busy', 'true');
  expect(row).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('cloud:opening_file');
  const opening = bridge.send.mock.calls.at(-1)![1];
  await act(async () =>
    listeners.get('from:cloud:result')!({
      requestId: opening.requestId,
      ok: false,
      error: 'network',
    } as never),
  );
  expect(row).toBeEnabled();
  expect(row).toHaveAttribute('aria-busy', 'false');
  expect(screen.queryByText('cloud:opening_file')).not.toBeInTheDocument();
  act(() => manager.dispose());
});

test('creating a file shows visible progress until the request settles', async () => {
  const { manager, managers, bridge, listeners, state, push } = setup();
  state.connections[0].writeAccess = true;
  push({ ...state, revision: 2 });
  manager.selectWorkspace('drive');
  renderWithProviders(<CloudExplorer />, { managers });
  registerPromptOpener(async () => ({
    button: 'confirm',
    value: 'Created.md',
  }));
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'cloud:new_file' })),
  );
  expect(screen.getByText('cloud:creating_file')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'cloud:new_file' }),
  ).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('button', { name: 'cloud:new_file' })).toBeDisabled();
  const create = bridge.send.mock.calls.at(-1)![1];
  await act(async () =>
    listeners.get('from:cloud:result')!({
      requestId: create.requestId,
      ok: false,
      error: 'duplicate',
    } as never),
  );
  expect(screen.queryByText('cloud:creating_file')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'cloud:new_file' })).toBeEnabled();
  registerPromptOpener(async () => ({ button: null }));
  act(() => manager.dispose());
});

test('save-copy help is available on the menu item and is portalled outside the menu', async () => {
  const { manager, managers } = setup();
  manager.selectWorkspace('drive');
  jest.spyOn(manager, 'canCreate').mockReturnValue(true);
  const files = fakeFileManager({
    activeFile: 'untitled-1',
    tabs: [{ path: 'untitled-1', name: 'Untitled 1' }],
  });
  renderWithProviders(<CloudExplorer />, {
    managers: { ...managers, fileManager: files as never },
  });
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'cloud:actions' }).focus();
  await user.keyboard('{Enter}');
  await user.hover(screen.getByRole('menuitem', { name: 'cloud:save_copy' }));
  const tooltip = await screen.findByRole('tooltip');
  expect(tooltip).toHaveTextContent('cloud:save_copy_help');
  expect(screen.getByRole('menu')).not.toContainElement(tooltip);
  act(() => manager.dispose());
});

test('Drive roots are in the location menu and selecting shared drives requests their listing', async () => {
  const { manager, managers, bridge } = setup();
  manager.selectWorkspace('drive');
  renderWithProviders(<CloudExplorer />, { managers });
  expect(screen.queryByText('cloud:shared_drives')).not.toBeInTheDocument();
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'cloud:location' }).focus();
  await user.keyboard('{Enter}');
  await user.click(
    await screen.findByRole('menuitem', { name: 'cloud:shared_drives' }),
  );
  expect(bridge.send.mock.calls.at(-1)![1].command).toMatchObject({
    action: 'drives',
    connectionId: 'drive',
  });
  act(() => manager.dispose());
});

test.each(['saved', 'saving', undefined] as const)(
  'normal connected document phase %s does not add a status banner',
  (phase) => {
    const { manager, managers } = setup();
    const snapshot = {
      activeFile: 'remote',
      tabs: [
        {
          path: 'remote',
          name: 'notes.md',
          dirty: false,
          remote: {
            connectionId: 'drive',
            accountId: 'account',
            connectionName: 'Drive',
            item: {
              id: 'file',
              name: 'notes.md',
              kind: 'markdown',
              parents: [],
            },
          },
          remoteSave: phase ? { phase } : undefined,
        },
      ],
    };
    const files = { ...fakeFileManager(), getSnapshot: () => snapshot };
    const { container } = renderWithProviders(<RemoteDocumentNotice />, {
      managers: { ...managers, fileManager: files as never },
    });
    expect(container).toBeEmptyDOMElement();
    act(() => manager.dispose());
  },
);

test.each(['saved', 'unconfirmed', 'disconnected'] as const)(
  'remote file menu preserves safe recovery for %s documents',
  async (phase) => {
    const { manager, managers } = setup(phase !== 'disconnected');
    const snapshot = {
      activeFile: 'remote',
      tabs: [
        {
          path: 'remote',
          name: 'notes.md',
          dirty: false,
          remote: {
            connectionId: 'drive',
            accountId: 'account',
            connectionName: 'Drive',
            item: {
              id: 'file',
              name: 'notes.md',
              kind: 'markdown',
              parents: [],
            },
          },
          remoteSave: {
            phase: phase === 'unconfirmed' ? 'unconfirmed' : 'saved',
          },
        },
      ],
    };
    const copyRemoteToLocal = jest.fn();
    const files = {
      ...fakeFileManager(),
      getSnapshot: () => snapshot,
      copyRemoteToLocal,
    };
    renderWithProviders(<RemoteDocumentMenu />, {
      managers: { ...managers, fileManager: files as never },
    });
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'cloud:document_actions' }).focus();
    await user.keyboard('{Enter}');
    const reload = await screen.findByRole('menuitem', {
      name: 'cloud:reload',
    });
    if (phase === 'saved') expect(reload).toBeEnabled();
    else expect(reload).toHaveAttribute('aria-disabled', 'true');
    if (phase === 'unconfirmed')
      expect(
        screen.getByRole('menuitem', { name: 'cloud:check_save' }),
      ).toBeEnabled();
    if (phase === 'disconnected')
      expect(screen.getByRole('status')).toHaveTextContent(
        'cloud:disconnected',
      );
    await user.click(
      screen.getByRole('menuitem', { name: 'cloud:local_copy' }),
    );
    expect(copyRemoteToLocal).toHaveBeenCalledWith('remote');
    act(() => manager.dispose());
  },
);

test('connection sign-out removes the account display and disables access testing', () => {
  const { manager, managers, push, state } = setup();
  renderWithProviders(<CloudConnections />, { managers });
  expect(screen.getByText('user@example.test')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'cloud:test' })).toBeEnabled();
  push({
    ...state,
    revision: 2,
    connections: [
      {
        ...state.connections[0],
        accountName: undefined,
        accountId: undefined,
        status: 'disconnected',
      },
    ],
  });
  expect(screen.queryByText('user@example.test')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'cloud:test' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'cloud:connect' })).toBeEnabled();
  act(() => manager.dispose());
});

test('normal sign-in needs no client credentials and custom configuration stays under Advanced', async () => {
  const { manager, managers, bridge, state, push, listeners } = setup();
  push({ ...state, connections: [] });
  renderWithProviders(<CloudConnections />, { managers });
  await act(async () => {
    listeners.get('from:cloud:result')!({
      requestId: bridge.send.mock.calls.at(-1)![1].requestId,
      ok: true,
      state: { ...state, connections: [] },
    } as never);
  });
  expect(screen.queryByLabelText('cloud:client_id')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('cloud:client_value')).not.toBeInTheDocument();
  screen.getByRole('button', { name: 'cloud:connect' }).focus();
  await userEvent.setup().keyboard('{Enter}');
  expect(bridge.send.mock.calls.at(-1)![1].command).toMatchObject({
    action: 'add',
    name: 'Google Drive',
    authorize: true,
  });
  expect(bridge.send.mock.calls.at(-1)![1].command).not.toHaveProperty(
    'clientId',
  );
  const advanced = screen.getByRole('button', { name: 'cloud:advanced' });
  fireEvent.click(advanced);
  expect(advanced).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByLabelText('cloud:client_id')).toBeInTheDocument();
  expect(screen.getByLabelText('cloud:client_value')).toBeInTheDocument();
  act(() => manager.dispose());
});

test('builds without a shared registration explain unavailable sign-in without exposing developer fields by default', () => {
  const { manager, managers, state, push } = setup();
  push({ ...state, connections: [], googleDriveAvailable: false });
  renderWithProviders(<CloudConnections />, { managers });
  expect(screen.getByRole('button', { name: 'cloud:connect' })).toBeDisabled();
  expect(screen.getByText('cloud:default_unavailable')).toBeInTheDocument();
  expect(screen.queryByLabelText('cloud:client_id')).not.toBeInTheDocument();
  act(() => manager.dispose());
});

test('browser offers pagination/refresh, shows errors and disables unsupported files', async () => {
  const { manager, managers, listeners, bridge, state } = setup();
  manager.selectWorkspace('drive');
  renderWithProviders(<CloudExplorer />, { managers });
  const request = bridge.send.mock.calls.find(
    ([, payload]) => payload.command.action === 'list',
  )![1];
  act(() =>
    listeners.get('from:cloud:result')!({
      requestId: request.requestId,
      ok: true,
      state,
      page: {
        items: [
          { id: 'doc', name: 'notes.md', kind: 'markdown', parents: [] },
          { id: 'native', name: 'Google.md', kind: 'unsupported', parents: [] },
        ],
        nextPage: 'more',
      },
    } as never),
  );
  await act(async () => {});
  expect(screen.getByRole('button', { name: /Google.md/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: /notes.md/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'cloud:load_more' }));
  expect(bridge.send.mock.calls.at(-1)![1].command).toMatchObject({
    action: 'list',
    page: 'more',
  });
  const next = bridge.send.mock.calls.at(-1)![1];
  act(() =>
    listeners.get('from:cloud:result')!({
      requestId: next.requestId,
      ok: false,
      error: 'permission',
    } as never),
  );
  await act(async () => {});
  expect(screen.getByRole('alert')).toHaveTextContent('cloud:error_permission');
  expect(screen.getByRole('button', { name: 'cloud:refresh' })).toBeEnabled();
  act(() => manager.dispose());
});

test('remote document stays visible after disconnect and offers a local copy', () => {
  const { manager, managers } = setup(false);
  const document: RemoteDocument = {
    connectionId: 'drive',
    accountId: 'account',
    connectionName: 'Personal Drive',
    item: { id: 'file', name: 'notes.md', kind: 'markdown', parents: [] },
    content: 'contents',
  };
  const snapshot = {
    activeFile: 'cloud-drive://drive/account/file',
    tabs: [
      {
        path: 'cloud-drive://drive/account/file',
        name: 'notes.md',
        remote: document,
        dirty: false,
      },
    ],
  };
  const files = {
    ...fakeFileManager(),
    copyRemoteToLocal: jest.fn(),
    getSnapshot: () => snapshot,
  };
  renderWithProviders(<RemoteDocumentNotice />, {
    managers: { ...managers, fileManager: files as never },
  });
  expect(screen.getByRole('status')).toHaveTextContent('cloud:disconnected');
  fireEvent.click(screen.getByRole('button', { name: 'cloud:local_copy' }));
  expect(files.copyRemoteToLocal).toHaveBeenCalledWith(
    'cloud-drive://drive/account/file',
  );
  act(() => manager.dispose());
});

test('editing consent is explicit and keyboard accessible', async () => {
  const { manager, managers, bridge } = setup();
  registerPromptOpener(async (request) => {
    expect(request.description).toBe('cloud:editing_permission');
    return { button: 'confirm' };
  });
  renderWithProviders(<CloudConnections />, { managers });
  screen.getByRole('button', { name: 'cloud:enable_editing' }).focus();
  await userEvent.setup().keyboard('{Enter}');
  expect(bridge.send.mock.calls.at(-1)![1].command).toMatchObject({
    action: 'connect',
    connectionId: 'drive',
    writeAccess: true,
  });
  registerPromptOpener(async () => ({ button: null }));
  act(() => manager.dispose());
});

test('unconfirmed saves expose a keyboard-accessible check action and preserve local-copy recovery', async () => {
  const { manager, managers } = setup();
  const path = 'cloud-drive://drive/account/file';
  const snapshot = {
    activeFile: path,
    tabs: [
      {
        path,
        name: 'notes.md',
        dirty: true,
        remoteSave: { phase: 'unconfirmed', error: 'unconfirmed' },
        remote: {
          connectionId: 'drive',
          accountId: 'account',
          connectionName: 'Drive',
          item: { id: 'file', name: 'notes.md', kind: 'markdown', parents: [] },
        },
      },
    ],
  };
  const files = {
    ...fakeFileManager(),
    hasUnconfirmedRemoteSave: () => true,
    saveTab: jest.fn(async () => false),
    copyRemoteToLocal: jest.fn(),
    getSnapshot: () => snapshot,
  };
  renderWithProviders(<RemoteDocumentNotice />, {
    managers: { ...managers, fileManager: files as never },
  });
  expect(screen.getByRole('status')).toHaveTextContent(
    'cloud:error_unconfirmed',
  );
  expect(
    screen.queryByRole('button', { name: 'cloud:reload' }),
  ).not.toBeInTheDocument();
  screen.getByRole('button', { name: 'cloud:check_save' }).focus();
  await userEvent.setup().keyboard('{Enter}');
  expect(files.saveTab).toHaveBeenCalledWith(path);
  expect(
    screen.getByRole('button', { name: 'cloud:local_copy' }),
  ).toBeEnabled();
  act(() => manager.dispose());
});
