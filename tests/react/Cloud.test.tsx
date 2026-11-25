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
  CloudProviderId,
  RemoteDocument,
} from '../../src/app/interfaces/Cloud';
import { renderWithProviders, fakeFileManager } from '../utils/render';
import { registerPromptOpener } from '../../src/browser/prompts';
import { usePrompts } from '../../src/browser/react/contexts/PromptsContext';
import { sonnerToast } from '../../src/browser/notify';

jest.mock('../../src/browser/notify', () => ({ sonnerToast: jest.fn() }));
beforeEach(() => jest.mocked(sonnerToast).mockClear());

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
function setup(connected = true, provider?: CloudProviderId) {
  const listeners = new Map<string, (value: never) => void>();
  const bridge = {
    send: jest.fn(),
    receive: (channel: string, fn: (value: never) => void) => {
      listeners.set(channel, fn);
    },
  };
  const manager = new CloudManager(bridge, {
    tabs: new Map(),
    openRemoteDocument: jest.fn(),
    hasUnconfirmedRemoteSave: () => false,
  } as never);
  const state: CloudState = {
    revision: 1,
    secureStorage: true,
    googleDriveAvailable: true,
    connections: [
      {
        id: 'drive',
        provider,
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

test('Dropbox sign-in uses its provider and public registration', async () => {
  const { manager, managers, push, state } = setup();
  push({ ...state, revision: 2, dropboxAvailable: true });
  const run = jest.spyOn(manager, 'run').mockResolvedValue(true);
  renderWithProviders(<CloudConnections />, { managers });
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'cloud:dropbox.connect' }));
  expect(run).toHaveBeenCalledWith({
    action: 'add',
    provider: 'dropbox',
    name: 'Dropbox',
    authorize: true,
  });
});

const PromptRegistration: React.FC = () => {
  const { open } = usePrompts();
  React.useEffect(() => registerPromptOpener(open), [open]);
  return null;
};

describe.each<CloudProviderId>(['google-drive', 'dropbox'])(
  '%s first connection dialog',
  (provider) => {
    test.each(['now', 'later'])(
      'explains read-only access and handles %s',
      async (choice) => {
        const { manager, managers, bridge, listeners, state, push } = setup(
          false,
          provider,
        );
        push({ ...state, revision: 2, dropboxAvailable: true });
        renderWithProviders(
          <>
            <PromptRegistration />
            <CloudConnections />
          </>,
          { managers },
        );
        const initial = bridge.send.mock.calls.at(-1)![1];
        await act(async () =>
          listeners.get('from:cloud:result')!({
            requestId: initial.requestId,
            ok: true,
            state: { ...state, revision: 2, dropboxAvailable: true },
          } as never),
        );
        const user = userEvent.setup();
        await user.click(
          within(
            screen.getByRole('region', {
              name: provider === 'dropbox' ? 'Dropbox' : 'Google Drive',
            }),
          ).getByRole('button', {
            name:
              provider === 'dropbox'
                ? 'cloud:dropbox.connect'
                : 'cloud:add_account',
          }),
        );
        const signIn = bridge.send.mock.calls.at(-1)![1];
        const connected = {
          ...state,
          revision: 3,
          connections: [
            {
              ...state.connections[0],
              status: 'connected' as const,
              hasConnected: true,
              accountId: 'account',
            },
          ],
        };
        await act(async () =>
          listeners.get('from:cloud:result')!({
            requestId: signIn.requestId,
            ok: true,
            state: connected,
            connectionId: 'drive',
          } as never),
        );
        const dialog = await screen.findByRole('dialog', {
          name: 'cloud:editing_intro_title',
        });
        expect(
          within(dialog).getByText(
            `cloud:${provider === 'dropbox' ? 'dropbox.' : ''}editing_intro_description`,
          ),
        ).toBeVisible();
        expect(screen.getByRole('status', { hidden: true })).toHaveTextContent(
          'cloud:read_only',
        );
        if (choice === 'now') {
          await user.click(
            within(dialog).getByRole('button', {
              name: 'cloud:enable_editing_now',
            }),
          );
          expect(bridge.send.mock.calls.at(-1)![1].command).toMatchObject({
            action: 'connect',
            connectionId: 'drive',
            writeAccess: true,
          });
          push({
            ...connected,
            revision: 4,
            connections: [{ ...connected.connections[0], writeAccess: true }],
          });
          expect(screen.getByRole('status')).toHaveTextContent(
            'cloud:editable',
          );
        } else {
          await user.click(
            within(dialog).getByRole('button', { name: 'cloud:later' }),
          );
          expect(
            bridge.send.mock.calls.some(
              ([, request]) => request.command.action === 'connect',
            ),
          ).toBe(false);
          expect(
            screen.getByRole('button', { name: 'cloud:enable_editing' }),
          ).toBeEnabled();
          expect(screen.getByRole('status')).toHaveTextContent(
            'cloud:read_only',
          );
        }
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        registerPromptOpener(async () => ({ button: null }));
        act(() => manager.dispose());
      },
    );
  },
);

test('Dropbox Explorer uses its own root and offers folder creation', async () => {
  const { manager, managers, push, state } = setup();
  push({
    ...state,
    revision: 2,
    dropboxAvailable: true,
    connections: [
      {
        ...state.connections[0],
        provider: 'dropbox',
        name: 'Personal Dropbox',
        writeAccess: true,
      },
    ],
  });
  manager.selectWorkspace('drive');
  renderWithProviders(<CloudExplorer />, { managers });
  expect(manager.getSnapshot().workspace).toBe('drive');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'cloud:location' }));
  expect(
    document.querySelector('img[src="./dropbox.svg"]'),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('menuitem', { name: 'cloud:shared_drives' }),
  ).not.toBeInTheDocument();
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'cloud:actions' }));
  expect(
    screen.getByRole('menuitem', { name: 'cloud:new_folder' }),
  ).toBeEnabled();
  expect(
    screen.getByRole('menuitem', { name: 'cloud:dropbox.save_copy' }),
  ).toBeInTheDocument();
  manager.dispose();
});

describe.each<CloudProviderId>(['google-drive', 'dropbox'])(
  '%s recovery controls',
  (provider) => {
    test.each(['create', 'folder'] as const)(
      'shows a pending %s only for the selected connected account and restores it on return',
      async (kind) => {
        const { manager, managers, bridge, listeners, state, push } = setup(
          true,
          provider,
        );
        state.connections[0].writeAccess = true;
        state.pendingOperations = [
          {
            provider,
            connectionId: 'drive',
            accountId: 'account',
            operationId: 'restored',
            kind: 'save',
            itemId: 'item',
            name: 'Original.md',
          },
        ];
        push(state);
        manager.selectWorkspace('drive');
        registerPromptOpener(async () => ({
          button: 'confirm',
          value: kind === 'create' ? 'New.md' : 'Folder',
        }));
        const creating =
          kind === 'create' ? manager.create() : manager.createFolder();
        await Promise.resolve();
        const request = bridge.send.mock.calls.at(-1)![1];
        listeners.get('from:cloud:result')!({
          requestId: request.requestId,
          ok: false,
          error: 'unconfirmed',
        } as never);
        await creating;
        registerPromptOpener(async () => ({ button: null }));
        renderWithProviders(<CloudExplorer />, { managers });
        const label =
          kind === 'create' ? 'cloud:check_create' : 'cloud:check_operation';
        expect(
          screen.getByRole('button', { name: label, exact: true }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: /Original.md/ }),
        ).toBeInTheDocument();
        push({
          ...state,
          connections: [
            ...state.connections,
            {
              ...state.connections[0],
              id: 'other',
              accountId: 'other-account',
            },
          ],
        });
        act(() => manager.selectWorkspace('other'));
        expect(
          screen.queryByRole('button', { name: label, exact: true }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: /Original.md/ }),
        ).not.toBeInTheDocument();
        act(() => manager.selectWorkspace('drive'));
        push({
          ...state,
          connections: [{ ...state.connections[0], accountId: 'replacement' }],
        });
        expect(
          screen.queryByRole('button', { name: label, exact: true }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: /Original.md/ }),
        ).not.toBeInTheDocument();
        push({
          ...state,
          connections: [{ ...state.connections[0], status: 'disconnected' }],
        });
        expect(
          screen.queryByRole('button', { name: label, exact: true }),
        ).not.toBeInTheDocument();
        push(state);
        expect(
          screen.getByRole('button', { name: label, exact: true }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: /Original.md/ }),
        ).toBeInTheDocument();
        act(() => manager.dispose());
      },
    );
  },
);

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
  expect(sonnerToast).toHaveBeenCalledTimes(1);
  expect(sonnerToast).toHaveBeenCalledWith('error', 'cloud:error_duplicate');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('cloud:error_duplicate')).not.toBeInTheDocument();
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
  expect(sonnerToast).toHaveBeenCalledWith('error', 'cloud:error_permission');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

async function explorerContext(provider?: CloudProviderId) {
  const context = setup(true, provider);
  context.state.connections[0].writeAccess = true;
  context.push(context.state);
  context.manager.selectWorkspace('drive');
  renderWithProviders(<CloudExplorer />, { managers: context.managers });
  const request = context.bridge.send.mock.calls.find(
    (call) => call[1].command.action === 'list',
  )![1];
  const item = {
    id: 'notes',
    name: 'notes.md',
    kind: 'markdown',
    parents: ['root'],
  };
  const folder = {
    id: 'drafts',
    name: 'Drafts',
    kind: 'folder',
    parents: ['root'],
  };
  await act(async () =>
    context.listeners.get('from:cloud:result')!({
      requestId: request.requestId,
      ok: true,
      state: context.state,
      page: { items: [item, folder] },
    } as never),
  );
  return { ...context, item, folder };
}

describe.each<CloudProviderId>(['google-drive', 'dropbox'])(
  '%s context-menu creation',
  (provider) => {
    test.each(['success', 'duplicate', 'unconfirmed'] as const)(
      'reports %s through Sonner and retains recovery controls',
      async (outcome) => {
        const { manager, bridge, listeners, state, folder } =
          await explorerContext(provider);
        registerPromptOpener(async () => ({
          button: 'confirm',
          value: 'New.md',
        }));
        fireEvent.contextMenu(screen.getByRole('button', { name: 'Drafts' }), {
          clientX: 50,
          clientY: 100,
        });
        await userEvent
          .setup()
          .click(
            await screen.findByRole('menuitem', { name: 'cloud:new_file' }),
          );
        const create = bridge.send.mock.calls.at(-1)![1];
        expect(create.command).toMatchObject({
          action: 'create',
          folderId: folder.id,
          name: 'New.md',
        });
        expect(sonnerToast).not.toHaveBeenCalled();
        await act(async () =>
          listeners.get('from:cloud:result')!({
            requestId: create.requestId,
            ...(outcome === 'success'
              ? {
                  ok: true,
                  state,
                  document: {
                    connectionId: 'drive',
                    accountId: 'account',
                    connectionName: 'Drive',
                    provider,
                    item: {
                      id: 'new',
                      name: 'New.md',
                      kind: 'markdown',
                      parents: [folder.id],
                    },
                    content: '',
                  },
                }
              : { ok: false, error: outcome }),
          } as never),
        );
        expect(sonnerToast).toHaveBeenCalledTimes(1);
        expect(sonnerToast).toHaveBeenCalledWith(
          outcome === 'success' ? 'success' : 'error',
          outcome === 'success'
            ? 'cloud:created_file'
            : `cloud:${provider === 'dropbox' && outcome === 'unconfirmed' ? 'dropbox.' : ''}error_${outcome}`,
        );
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        if (outcome === 'unconfirmed')
          expect(
            screen.getByRole('button', { name: 'cloud:check_create' }),
          ).toBeEnabled();
        registerPromptOpener(async () => ({ button: null }));
        act(() => manager.dispose());
      },
    );
  },
);

test.each<CloudProviderId>(['google-drive', 'dropbox'])(
  '%s context menus distinguish documents, folders and empty space',
  async (provider) => {
    const { manager } = await explorerContext(provider);
    const create = jest.spyOn(manager, 'createFolder').mockResolvedValue();
    const user = userEvent.setup();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'notes.md' }), {
      clientX: 50,
      clientY: 100,
    });
    expect(
      await screen.findByRole('menuitem', { name: 'cloud:open' }),
    ).toBeInTheDocument();
    const move = screen.getByRole('menuitem', { name: 'cloud:move_to' });
    if (provider === 'dropbox') {
      expect(move).toHaveAttribute('data-disabled');
      fireEvent.click(move);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(manager.getSnapshot().movePicker).toBeUndefined();
    } else expect(move).not.toHaveAttribute('data-disabled');
    expect(
      screen.queryByRole('menuitem', { name: 'cloud:new_folder' }),
    ).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Drafts' }), {
      clientX: 50,
      clientY: 100,
    });
    expect(
      await screen.findByRole('menuitem', { name: 'cloud:new_file' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'cloud:move_to' }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('menuitem', { name: 'cloud:new_folder' }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'drafts' }),
    );
    fireEvent.contextMenu(
      screen.getByRole('list', { name: 'cloud:files' }).parentElement!,
      { clientX: 50, clientY: 350 },
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'cloud:new_folder' }),
    );
    expect(create).toHaveBeenLastCalledWith(undefined);
    act(() => manager.dispose());
  },
);

test.each<CloudProviderId>(['google-drive'])(
  '%s Move to picker browses folders without changing Explorer and cancellation does not move',
  async (provider) => {
    const { manager, bridge, state, listeners } =
      await explorerContext(provider);
    const user = userEvent.setup();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'notes.md' }), {
      clientX: 50,
      clientY: 100,
    });
    await user.click(
      await screen.findByRole('menuitem', { name: 'cloud:move_to' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      dialog.querySelector(
        `img[src="./${provider === 'dropbox' ? 'dropbox.svg' : 'google-drive.png'}"]`,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('notes.md')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'cloud:move_here' }),
    ).toBeDisabled();
    const listing = bridge.send.mock.calls.at(-1)![1];
    await act(async () =>
      listeners.get('from:cloud:result')!({
        requestId: listing.requestId,
        ok: true,
        state,
        page: {
          items: [
            { id: 'folder', name: 'Drafts', kind: 'folder', parents: ['root'] },
            {
              id: 'hidden',
              name: 'Hidden.md',
              kind: 'markdown',
              parents: ['root'],
            },
          ],
        },
      } as never),
    );
    expect(within(dialog).queryByText('Hidden.md')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Drafts' }));
    const nested = bridge.send.mock.calls.at(-1)![1];
    await act(async () =>
      listeners.get('from:cloud:result')!({
        requestId: nested.requestId,
        ok: true,
        state,
        page: { items: [] },
      } as never),
    );
    expect(
      within(dialog).getByRole('button', { name: 'cloud:move_here' }),
    ).toBeEnabled();
    expect(manager.getSnapshot().folders.at(-1)?.id).toBe('root');
    await user.click(
      within(dialog).getByRole('button', { name: 'cloud:cancel' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      bridge.send.mock.calls.some((call) => call[1].command.action === 'move'),
    ).toBe(false);
    act(() => manager.dispose());
  },
);

test('read-only Drive accounts disable creation and moves in the context menu', async () => {
  const { manager, push, state } = await explorerContext();
  state.connections[0].writeAccess = false;
  push({ ...state, revision: 2 });
  fireEvent.contextMenu(screen.getByRole('button', { name: 'notes.md' }), {
    clientX: 50,
    clientY: 100,
  });
  expect(
    await screen.findByRole('menuitem', { name: 'cloud:move_to' }),
  ).toHaveAttribute('data-disabled');
  await userEvent.setup().keyboard('{Escape}');
  fireEvent.contextMenu(
    screen.getByRole('list', { name: 'cloud:files' }).parentElement!,
    { clientX: 50, clientY: 350 },
  );
  expect(
    await screen.findByRole('menuitem', { name: 'cloud:new_folder' }),
  ).toHaveAttribute('data-disabled');
  act(() => manager.dispose());
});
