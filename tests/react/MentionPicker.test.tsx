import * as React from 'react';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { MentionPicker } from '../../src/browser/react/components/assistant/MentionPicker';
import { FileTreeManager } from '../../src/browser/core/FileTreeManager';

jest.mock('../../src/browser/i18n', () => ({ t: (key: string) => key }));

function workspace(paths: string[]) {
  let files = paths;
  const loader = jest.fn(async () => [...files]);
  const bridge = { send: jest.fn(), receive: jest.fn() };
  const manager = new FileTreeManager(bridge, jest.fn(), loader);
  manager.buildFileTree(
    [
      {
        type: 'directory',
        name: 'poems',
        path: '/w/poems',
        hasChildren: true,
        loaded: false,
      },
    ],
    '/w',
  );
  return {
    manager,
    bridge,
    loader,
    setFiles: (next: string[]) => {
      files = next;
    },
  };
}
const props = { onPick: jest.fn(), onClose: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
});

it('lists unopened files below collapsed folders without opening or expanding anything', async () => {
  const { manager, bridge, loader } = workspace([
    '/w/poems/deep/sonnet.md',
    '/w/poems/second.md',
    '/w/config.json',
  ]);
  const snapshot = manager.getSnapshot();
  const { rerender } = render(
    <MentionPicker {...props} query="poem" open fileTreeManager={manager} />,
  );
  expect(
    await screen.findByTestId('mention-option-/w/poems/deep/sonnet.md'),
  ).toBeInTheDocument();
  expect(
    screen.getByTestId('mention-option-/w/poems/second.md'),
  ).toBeInTheDocument();
  expect(manager.getSnapshot()).toBe(snapshot);
  expect(snapshot.nodes[0].loaded).toBe(false);
  expect(bridge.send).not.toHaveBeenCalled();
  rerender(
    <MentionPicker {...props} query="config" open fileTreeManager={manager} />,
  );
  expect(
    screen.getByTestId('mention-option-/w/config.json'),
  ).toBeInTheDocument();
  expect(loader).toHaveBeenCalledTimes(1);
});

it('does not subscribe or list files while hidden', () => {
  const { manager, loader } = workspace(['/w/a.md']);
  const subscribe = jest.spyOn(manager, 'on');
  const read = jest.spyOn(manager, 'getSnapshot');
  render(
    <MentionPicker
      {...props}
      query=""
      open={false}
      fileTreeManager={manager}
    />,
  );
  expect(subscribe).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(loader).not.toHaveBeenCalled();
  expect(screen.queryByTestId('mention-picker')).not.toBeInTheDocument();
});

it('ranks basename matches before directory matches and normalizes separators', async () => {
  const { manager } = workspace(['/w/notes/notes.md', '/w/no-dir/other.md']);
  const { rerender } = render(
    <MentionPicker {...props} query="no" open fileTreeManager={manager} />,
  );
  await screen.findByTestId('mention-option-/w/notes/notes.md');
  expect(screen.getAllByRole('option')[0]).toHaveAttribute(
    'title',
    '/w/notes/notes.md',
  );
  rerender(
    <MentionPicker
      {...props}
      query={'notes\\notes'}
      open
      fileTreeManager={manager}
    />,
  );
  expect(screen.getAllByRole('option')).toHaveLength(1);
});

it('picks a current path by click or keyboard and closes on Escape', async () => {
  const { manager } = workspace(['/w/a.md', '/w/b.md']);
  render(<MentionPicker {...props} query="" open fileTreeManager={manager} />);
  await screen.findByTestId('mention-option-/w/a.md');
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(props.onPick).toHaveBeenCalledWith('/w/b.md');
  fireEvent.click(screen.getByTestId('mention-option-/w/a.md'));
  expect(props.onPick).toHaveBeenCalledWith('/w/a.md');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(props.onClose).toHaveBeenCalled();
});

it('can find files beyond the first page and leaves IME confirmation alone', async () => {
  const { manager } = workspace([
    ...Array.from({ length: 40 }, (_, i) => `/w/poems/${i}.md`),
    '/w/poems/zz-last.md',
  ]);
  const { rerender } = render(
    <MentionPicker {...props} query="" open fileTreeManager={manager} />,
  );
  await screen.findAllByRole('option');
  expect(screen.getAllByRole('option')).toHaveLength(20);
  rerender(
    <MentionPicker {...props} query="zz-last" open fileTreeManager={manager} />,
  );
  expect(
    screen.getByTestId('mention-option-/w/poems/zz-last.md'),
  ).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Enter', isComposing: true });
  expect(props.onPick).not.toHaveBeenCalled();
});

it('refreshes created, renamed, moved and deleted entries while the picker stays open', async () => {
  const { manager, setFiles } = workspace(['/w/poems/old.md']);
  render(
    <MentionPicker {...props} query="poems" open fileTreeManager={manager} />,
  );
  await screen.findByTestId('mention-option-/w/poems/old.md');
  setFiles(['/w/poems/renamed.md', '/w/poems/nested/created.md']);
  act(() => manager.buildFileTree([], '/w'));
  await screen.findByTestId('mention-option-/w/poems/renamed.md');
  expect(
    screen.queryByTestId('mention-option-/w/poems/old.md'),
  ).not.toBeInTheDocument();
  setFiles(['/w/poems/nested/moved.md']);
  act(() => manager.buildFileTree([], '/w'));
  await screen.findByTestId('mention-option-/w/poems/nested/moved.md');
  expect(
    screen.queryByTestId('mention-option-/w/poems/renamed.md'),
  ).not.toBeInTheDocument();
  setFiles([]);
  act(() => manager.buildFileTree([], '/w'));
  await screen.findByText('assistant-chat:mention_picker_empty');
  expect(screen.queryByRole('option')).not.toBeInTheDocument();
});

it('refreshes external file changes while visible and stops polling when closed', async () => {
  jest.useFakeTimers();
  const { manager, loader, setFiles } = workspace(['/w/old.md']);
  const { unmount } = render(
    <MentionPicker {...props} query="" open fileTreeManager={manager} />,
  );
  try {
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('mention-option-/w/old.md')).toBeInTheDocument();
    setFiles(['/w/new.md']);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId('mention-option-/w/new.md')).toBeInTheDocument();
    expect(
      screen.queryByTestId('mention-option-/w/old.md'),
    ).not.toBeInTheDocument();
    unmount();
    const calls = loader.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });
    expect(loader).toHaveBeenCalledTimes(calls);
  } finally {
    unmount();
    jest.useRealTimers();
  }
});

it('discards late results from the previous workspace', async () => {
  let finish!: (paths: string[]) => void;
  const { manager, loader } = workspace([]);
  loader.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<MentionPicker {...props} query="" open fileTreeManager={manager} />);
  await waitFor(() => expect(loader).toHaveBeenCalled());
  act(() => {
    manager.treeRoot = '/other';
    manager.buildFileTree([], '/other');
  });
  await screen.findByText('assistant-chat:mention_picker_empty');
  await act(async () => finish(['/w/stale.md']));
  expect(
    screen.queryByTestId('mention-option-/w/stale.md'),
  ).not.toBeInTheDocument();
});

it('does not scan a hidden window and refreshes when it regains focus', async () => {
  const visibility = jest
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden');
  const { manager, loader } = workspace(['/w/a.md']);
  const { unmount } = render(
    <MentionPicker {...props} query="" open fileTreeManager={manager} />,
  );
  try {
    expect(loader).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(screen.getByTestId('mention-option-/w/a.md')).toBeInTheDocument();
  } finally {
    unmount();
    visibility.mockRestore();
  }
});

it('shows loading and recoverable errors without picking a stale file', async () => {
  const { manager, loader } = workspace([]);
  loader.mockRejectedValueOnce(new Error('Read failed'));
  render(<MentionPicker {...props} query="" open fileTreeManager={manager} />);
  expect(
    screen.getByText('assistant-chat:mention_picker_loading'),
  ).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(props.onPick).not.toHaveBeenCalled();
  await screen.findByText('assistant-chat:mention_picker_error');
});

it('keeps keyboard selection valid when results arrive after an empty list', async () => {
  const { manager, setFiles } = workspace([]);
  render(<MentionPicker {...props} query="" open fileTreeManager={manager} />);
  await screen.findByText('assistant-chat:mention_picker_empty');
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  setFiles(['/w/a.md']);
  act(() => manager.buildFileTree([], '/w'));
  await screen.findByTestId('mention-option-/w/a.md');
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(props.onPick).toHaveBeenCalledWith('/w/a.md');
});
