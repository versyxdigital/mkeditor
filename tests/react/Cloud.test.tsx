import * as React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CloudConnections } from '../../src/browser/react/components/cloud/CloudConnections';
import { CloudExplorer } from '../../src/browser/react/components/cloud/CloudExplorer';
import { RemoteDocumentNotice } from '../../src/browser/react/components/cloud/RemoteDocumentNotice';
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
    'cloud:save_unconfirmed',
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
