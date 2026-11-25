import * as React from 'react';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CloudManager } from '../../src/browser/core/CloudManager';
import { CloudConnections } from '../../src/browser/react/components/cloud/CloudConnections';
import { RemoteDocumentNotice } from '../../src/browser/react/components/cloud/RemoteDocumentNotice';
import { CloudExplorer } from '../../src/browser/react/components/cloud/CloudExplorer';
import { RemoteDocumentMenu } from '../../src/browser/react/components/cloud/RemoteDocumentMenu';
import { Navbar } from '../../src/browser/react/components/Navbar';
import { SettingsModal } from '../../src/browser/react/components/modals/SettingsModal';
import { useModals } from '../../src/browser/react/contexts/ModalsContext';
import type {
  CloudConnection,
  CloudProviderId,
  CloudState,
} from '../../src/app/interfaces/Cloud';
import type { TabInfo } from '../../src/browser/core/FileManager';
import { fakeFileManager, renderWithProviders } from '../utils/render';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => key,

  normalizeLanguage: () => 'en',

  getAvailableLocales: async () => [],
}));

const managersToDispose: CloudManager[] = [];

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: jest.fn(),
  });
});

afterEach(() =>
  managersToDispose.splice(0).forEach((manager) => manager.dispose()),
);

function webCloud(configured = true) {
  const listeners = new Map<string, (value: never) => void>();
  const manager = new CloudManager(
    {
      send: jest.fn(),
      receive: (channel, listener) => listeners.set(channel, listener),
    },
    { tabs: new Map(), openRemoteDocument: jest.fn() } as never,
  );
  managersToDispose.push(manager);
  const state: CloudState = {
    revision: 1,
    secureStorage: true,
    googleDriveAvailable: configured,
    dropboxAvailable: configured,
    connections: [],
  };
  act(() => listeners.get('from:cloud:state')!(state as never));
  return {
    manager,
    push: (next: CloudState) =>
      act(() => listeners.get('from:cloud:state')!(next as never)),
    state,
    managers: {
      mode: 'web' as const,
      platform: 'web' as const,
      bridgeManager: { cloudManager: manager } as never,
    },
  };
}

const OpenConnections: React.FC = () => {
  const { openModal } = useModals();
  React.useEffect(() => {
    openModal('settings', { tab: 'connections' });
  }, [openModal]);
  return null;
};

function rememberedCloud(provider: CloudProviderId) {
  const setup = webCloud();
  const connection: CloudConnection = {
    id: 'remembered',
    provider,
    name: 'Personal cloud',
    clientId: 'public-browser-registration',
    clientValue: '',
    status: 'reauthorize',
    accountId: 'original-account',
    accountName: 'writer@example.test',
    hasConnected: true,
    writeAccess: true,
  };
  setup.push({ ...setup.state, revision: 2, connections: [connection] });
  const tab: TabInfo = {
    path: `cloud-${provider === 'dropbox' ? 'dropbox' : 'drive'}://remembered/original-account/document`,
    name: 'draft.md',
    dirty: true,
    remote: {
      provider,
      connectionId: connection.id,
      connectionName: connection.name,
      accountId: connection.accountId!,
      item: {
        id: 'document',
        name: 'draft.md',
        kind: 'markdown',
        parents: [],
        editable: true,
      },
    },
    remoteRecovery: { status: 'waiting' },
  };
  const files = {
    ...fakeFileManager({ tabs: [tab], activeFile: tab.path }),
    copyRemoteToLocal: jest.fn(),
  };
  return {
    ...setup,
    connection,
    tab,
    files,
    managers: { ...setup.managers, fileManager: files as never },
  };
}

describe.each<CloudProviderId>(['google-drive', 'dropbox'])(
  '%s browser reconnection',
  (provider) => {
    test('restored documents offer direct reconnection to their existing account', async () => {
      const { managers, manager, connection, files, tab, push, state } =
        rememberedCloud(provider);
      const run = jest.spyOn(manager, 'run').mockResolvedValue(true);
      renderWithProviders(
        <>
          <RemoteDocumentNotice />
          <SettingsModal />
        </>,
        { managers },
      );
      expect(screen.getByRole('status')).toHaveTextContent(
        'cloud:web_reconnect_document',
      );
      expect(screen.getByRole('status')).not.toHaveTextContent(
        'cloud:recovered_draft',
      );
      expect(screen.getByRole('status').querySelector('img')).toHaveAttribute(
        'src',
        provider === 'dropbox' ? './dropbox.svg' : './google-drive.png',
      );
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: 'cloud:web_reconnect' }));
      expect(run).toHaveBeenCalledWith({
        action: 'connect',
        connectionId: connection.id,
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      // Authorization alone must not claim the document has been checked.
      push({
        ...state,
        revision: 3,
        connections: [{ ...connection, status: 'connected' }],
      });
      expect(screen.getByRole('status')).toHaveTextContent(
        provider === 'dropbox'
          ? 'cloud:dropbox.recovered_draft'
          : 'cloud:recovered_draft',
      );
      act(() =>
        files._setSnapshot({
          activeFile: tab.path,
          tabs: [{ ...tab, remoteRecovery: undefined } as TabInfo],
        }),
      );
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    test('the toolbar labels remembered accounts and Explorer reconnects without adding one', async () => {
      const { managers, manager, connection } = rememberedCloud(provider);
      const run = jest.spyOn(manager, 'run').mockResolvedValue(true);
      renderWithProviders(
        <>
          <Navbar />
          <CloudExplorer />
        </>,
        { managers },
      );
      const user = userEvent.setup();
      screen.getByRole('combobox', { name: 'cloud:workspace' }).focus();
      await user.keyboard('{ArrowDown}');
      const account = screen.getByRole('option', { name: /Personal cloud/ });
      expect(account).toHaveTextContent('cloud:web_reconnect_status');
      expect(account).toHaveAttribute(
        'title',
        expect.stringContaining('writer@example.test'),
      );
      await user.click(account);
      expect(manager.getSnapshot().workspace).toBe(connection.id);
      expect(screen.getByRole('status')).toHaveTextContent(
        'cloud:web_reconnect_help',
      );
      await user.click(
        screen.getByRole('button', { name: 'cloud:web_reconnect' }),
      );
      expect(run).toHaveBeenCalledWith({
        action: 'connect',
        connectionId: connection.id,
      });
      expect(manager.getSnapshot().connections).toHaveLength(1);
    });

    test('cancelled reconnection exposes connection feedback while retaining the document and local-copy action', async () => {
      const { managers, manager, tab, files } = rememberedCloud(provider);
      jest.spyOn(manager, 'run').mockResolvedValue(false);
      renderWithProviders(
        <>
          <RemoteDocumentNotice />
          <SettingsModal />
        </>,
        { managers },
      );
      const user = userEvent.setup();
      await user.click(
        screen.getByRole('button', { name: 'cloud:web_reconnect' }),
      );
      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).getByRole('tab', { name: 'cloud:connections' }),
      ).toHaveAttribute('data-state', 'active');
      expect(files.getSnapshot().tabs).toEqual([tab]);
      expect(files.copyRemoteToLocal).not.toHaveBeenCalled();
    });

    test.each(['connecting', 'storage', 'registration'])(
      'reconnection is unavailable during %s',
      (reason) => {
        const { managers, connection, push, state } = rememberedCloud(provider);
        push({
          ...state,
          revision: 3,
          connections: [
            {
              ...connection,
              status: reason === 'connecting' ? 'connecting' : 'reauthorize',
            },
          ],
          secureStorage: reason !== 'storage',
          googleDriveAvailable: reason !== 'registration',
          dropboxAvailable: reason !== 'registration',
        });
        renderWithProviders(<RemoteDocumentNotice />, { managers });
        expect(
          screen.getByRole('button', { name: 'cloud:web_reconnect' }),
        ).toBeDisabled();
        expect(
          screen.getByRole('button', { name: 'cloud:local_copy' }),
        ).toBeEnabled();
      },
    );

    test('a different connected account cannot be used to reconnect the restored document', () => {
      const { managers, connection, push, state } = rememberedCloud(provider);
      push({
        ...state,
        revision: 3,
        connections: [
          {
            ...connection,
            status: 'connected',
            accountId: 'different-account',
          },
        ],
      });
      renderWithProviders(<RemoteDocumentNotice />, { managers });
      expect(
        screen.queryByRole('button', { name: 'cloud:web_reconnect' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'cloud:manage' }),
      ).toBeEnabled();
    });

    test('Settings and document menus describe reauthorisation as reconnection', async () => {
      const { managers } = rememberedCloud(provider);
      renderWithProviders(
        <>
          <CloudConnections />
          <RemoteDocumentMenu />
        </>,
        { managers },
      );
      const account = screen.getByRole('region', { name: 'Personal cloud' });
      expect(within(account).getByRole('status')).toHaveTextContent(
        'cloud:web_reconnect_status',
      );
      expect(
        within(account).getByRole('button', { name: 'cloud:reconnect' }),
      ).toBeEnabled();
      expect(screen.getByText('cloud:web_intro')).toBeVisible();
      const user = userEvent.setup();
      screen
        .getByRole('button', {
          name:
            provider === 'dropbox'
              ? 'cloud:dropbox.document_actions'
              : 'cloud:document_actions',
        })
        .focus();
      await user.keyboard('{Enter}');
      expect(
        within(screen.getByRole('menu')).getByRole('status'),
      ).toHaveTextContent('cloud:web_reconnect_status');
    });
  },
);

test.each(['web', 'desktop'] as const)(
  '%s toolbar exposes local storage and branded cloud sign-in before any account is connected',
  async (mode) => {
    const { managers } = webCloud();
    renderWithProviders(
      <>
        <Navbar />
        <SettingsModal />
      </>,
      { managers: { ...managers, mode } },
    );
    const picker = screen.getByRole('combobox', { name: 'cloud:workspace' });
    expect(picker).toHaveTextContent('cloud:local');
    expect(
      screen.getByRole('button', { name: 'navbar:toggle_sidebar' })
        .nextElementSibling,
    ).toBe(picker);
    const user = userEvent.setup();
    picker.focus();
    await user.keyboard('{ArrowDown}');
    expect(
      screen
        .getByRole('option', { name: 'cloud:connect', exact: true })
        .querySelector('img'),
    ).toHaveAttribute('src', './google-drive.png');
    expect(
      screen
        .getByRole('option', { name: 'cloud:dropbox.connect', exact: true })
        .querySelector('img'),
    ).toHaveAttribute('src', './dropbox.svg');
    await user.click(screen.getByRole('option', { name: 'cloud:manage' }));
    expect(
      screen.getByRole('tab', { name: 'cloud:connections' }),
    ).toHaveAttribute('data-state', 'active');
  },
);

test.each([
  ['google-drive', 'cloud:connect', 'Google Drive'],
  ['dropbox', 'cloud:dropbox.connect', 'Dropbox'],
] as const)(
  'web toolbar starts %s sign-in and opens Connections for progress and errors',
  async (provider, label, name) => {
    const { managers, manager } = webCloud();
    const run = jest.spyOn(manager, 'run').mockResolvedValue(true);
    renderWithProviders(
      <>
        <Navbar />
        <SettingsModal />
      </>,
      { managers },
    );
    const user = userEvent.setup();
    screen.getByRole('combobox', { name: 'cloud:workspace' }).focus();
    await user.keyboard('{ArrowDown}');
    await user.click(screen.getByRole('option', { name: label, exact: true }));
    expect(run).toHaveBeenCalledWith({
      action: 'add',
      provider,
      name,
      authorize: true,
    });
    expect(
      screen.getByRole('tab', { name: 'cloud:connections' }),
    ).toHaveAttribute('data-state', 'active');
  },
);

test('web toolbar keeps connection discovery available when sign-in is not configured', async () => {
  const { managers } = webCloud(false);
  renderWithProviders(
    <>
      <Navbar />
      <SettingsModal />
    </>,
    { managers },
  );
  const user = userEvent.setup();
  screen.getByRole('combobox', { name: 'cloud:workspace' }).focus();
  await user.keyboard('{ArrowDown}');
  expect(
    screen.getByRole('option', { name: 'cloud:connect', exact: true }),
  ).toHaveAttribute('aria-disabled', 'true');
  expect(
    screen.getByRole('option', { name: 'cloud:dropbox.connect', exact: true }),
  ).toHaveAttribute('aria-disabled', 'true');
  await user.click(screen.getByRole('option', { name: 'cloud:manage' }));
  expect(screen.getAllByText('cloud:web_config_unavailable')).toHaveLength(2);
});

test('web settings opens Connections while AI provider settings stay unavailable', async () => {
  const { managers } = webCloud();
  renderWithProviders(
    <>
      <OpenConnections />
      <SettingsModal />
    </>,
    { managers },
  );
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByRole('tab', { name: 'cloud:connections' }),
  ).toHaveAttribute('data-state', 'active');
  expect(
    within(dialog).queryByRole('tab', {
      name: 'modals-settings:tab_assistant',
    }),
  ).not.toBeInTheDocument();
  expect(within(dialog).getByRole('region', { name: 'Dropbox' })).toBeVisible();
  expect(dialog).not.toHaveTextContent('~/.mkeditor/');
});

test('web connection controls disable unavailable registrations and explain browser configuration', () => {
  const { managers } = webCloud(false);
  renderWithProviders(<CloudConnections />, { managers });
  for (const provider of ['Google Drive', 'Dropbox']) {
    expect(
      within(screen.getByRole('region', { name: provider })).getByRole(
        'button',
      ),
    ).toBeDisabled();
  }
  expect(
    screen.getAllByText(/cloud:web_config_unavailable/).length,
  ).toBeGreaterThan(0);
});

test('web registration uses deployment configuration without credential entry fields', () => {
  const { managers } = webCloud();
  renderWithProviders(<CloudConnections />, { managers });
  expect(
    screen.queryByRole('button', { name: 'cloud:advanced' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText('cloud:client_value')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('cloud:client_id')).not.toBeInTheDocument();
});

test('web navbar offers connected cloud workspaces without exposing the AI toggle', () => {
  const { managers, manager, state, push } = webCloud();
  push({
    ...state,
    revision: 2,
    connections: [
      {
        id: 'dropbox',
        provider: 'dropbox',
        name: 'Browser Dropbox',
        clientId: 'public-app-key',
        clientValue: '',
        status: 'connected',
        accountId: 'dbid:test',
      },
    ],
  });
  manager.selectWorkspace('dropbox');
  renderWithProviders(<Navbar />, { managers });
  expect(
    screen.getByRole('combobox', { name: 'cloud:workspace' }),
  ).toHaveTextContent('Browser Dropbox');
  expect(
    screen.queryByRole('button', { name: /assistant/i }),
  ).not.toBeInTheDocument();
});

test.each([
  ['web', 'cloud:web_storage_error'],
  ['desktop', 'cloud:error_storage'],
] as const)(
  '%s save failures explain the runtime storage boundary',
  (mode, message) => {
    const { managers, state, push } = webCloud();
    push({
      ...state,
      revision: 2,
      connections: [
        {
          id: 'drive',
          name: 'Drive',
          accountId: 'account',
          status: 'connected',
          clientId: 'public-web.apps.googleusercontent.com',
          clientValue: '',
          writeAccess: true,
        },
      ],
    });
    const path = 'cloud-drive://drive/account/document';
    const snapshot = {
      activeFile: path,
      tabs: [
        {
          path,
          name: 'draft.md',
          dirty: true,
          remote: {
            connectionId: 'drive',
            accountId: 'account',
            connectionName: 'Drive',
            item: {
              id: 'document',
              name: 'draft.md',
              kind: 'markdown',
              parents: [],
              editable: true,
            },
          },
          remoteSave: { phase: 'failed', error: 'storage' },
        },
      ],
    };
    renderWithProviders(<RemoteDocumentNotice />, {
      managers: {
        ...managers,
        mode,
        fileManager: {
          ...fakeFileManager(),
          getSnapshot: () => snapshot,
        } as never,
      },
    });
    expect(screen.getByRole('status')).toHaveTextContent(message);
    expect(
      screen.getByRole('button', { name: 'cloud:local_copy' }),
    ).toBeEnabled();
  },
);
