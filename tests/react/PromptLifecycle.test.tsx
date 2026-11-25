import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  PromptsProvider,
  usePrompts,
  type PromptRequest,
} from '../../src/browser/react/contexts/PromptsContext';
import {
  ToolConfirmProvider,
  useToolConfirm,
} from '../../src/browser/react/contexts/ToolConfirmContext';

const prompt = (title: string): PromptRequest => ({
  title,
  buttons: [{ id: 'confirm', label: 'Confirm' }],
});
const toolRequest = (toolCallId: string, callId = 'chat') => ({
  toolCallId,
  callId,
  toolName: 'write_file',
  arguments: {},
  preview: null,
});

function promptHarness() {
  let api!: ReturnType<typeof usePrompts>;
  function Probe() {
    api = usePrompts();
    return null;
  }
  const view = render(
    <PromptsProvider>
      <Probe />
    </PromptsProvider>,
  );
  return { ...view, api };
}

function toolHarness() {
  let api!: ReturnType<typeof useToolConfirm>;
  function Probe() {
    api = useToolConfirm();
    return (
      <span data-testid="current">{api.request?.toolCallId ?? 'none'}</span>
    );
  }
  const view = render(
    <ToolConfirmProvider>
      <Probe />
    </ToolConfirmProvider>,
  );
  return { ...view, api };
}

describe('generic prompt queue', () => {
  it('does not leave a cancelled prompt visible after Strict Mode effect replay', async () => {
    let result!: Promise<{ button: string | null }>;
    function Probe() {
      const { open } = usePrompts();
      const opened = React.useRef(false);
      React.useEffect(() => {
        if (!opened.current) {
          opened.current = true;
          result = open(prompt('Cancelled during replay'));
        }
      }, [open]);
      return null;
    }
    render(
      <React.StrictMode>
        <PromptsProvider>
          <Probe />
        </PromptsProvider>
      </React.StrictMode>,
    );
    await expect(result).resolves.toEqual({ button: null });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps concurrent prompts in order and resolves each caller with its own choice', async () => {
    const { api } = promptHarness();
    let first!: ReturnType<typeof api.open>;
    let second!: ReturnType<typeof api.open>;
    act(() => {
      first = api.open(prompt('First'));
      second = api.open(prompt('Second'));
    });
    expect(screen.getByRole('heading', { name: 'First' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(first).resolves.toEqual({ button: 'confirm' });
    expect(screen.getByRole('heading', { name: 'Second' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(second).resolves.toEqual({ button: 'confirm' });
  });

  it('settles active and queued prompts on unmount and safely cancels calls through a stale opener', async () => {
    const { api, unmount } = promptHarness();
    let first!: ReturnType<typeof api.open>;
    let second!: ReturnType<typeof api.open>;
    act(() => {
      first = api.open(prompt('First'));
      second = api.open(prompt('Second'));
    });
    unmount();
    await expect(first).resolves.toEqual({ button: null });
    await expect(second).resolves.toEqual({ button: null });
    await expect(api.open(prompt('After unmount'))).resolves.toEqual({
      button: null,
    });
  });
});

describe('tool confirmation lifecycle', () => {
  it('clears cancelled confirmation state after Strict Mode effect replay', async () => {
    let result!: Promise<boolean>;
    function Probe() {
      const api = useToolConfirm();
      const opened = React.useRef(false);
      React.useEffect(() => {
        if (!opened.current) {
          opened.current = true;
          result = api.open(toolRequest('replayed'));
        }
      }, [api.open]);
      return (
        <span data-testid="strict-current">
          {api.request?.toolCallId ?? 'none'}
        </span>
      );
    }
    render(
      <React.StrictMode>
        <ToolConfirmProvider>
          <Probe />
        </ToolConfirmProvider>
      </React.StrictMode>,
    );
    await expect(result).resolves.toBe(false);
    expect(screen.getByTestId('strict-current')).toHaveTextContent('none');
  });

  it('cancels a request opened and cancelled in the same event turn', async () => {
    const { api } = toolHarness();
    let result!: Promise<boolean>;
    act(() => {
      result = api.open(toolRequest('first'));
      api.cancelForCallId('chat');
    });
    await expect(result).resolves.toBe(false);
    expect(screen.getByTestId('current')).toHaveTextContent('none');
  });

  it('cancels a just-promoted queued request before another render', async () => {
    const { api } = toolHarness();
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = api.open(toolRequest('first', 'one'));
      second = api.open(toolRequest('second', 'two'));
      api.resolve(true);
      api.cancelForToolCallId('second');
    });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(screen.getByTestId('current')).toHaveTextContent('none');
  });

  it('settles every confirmation on unmount and rejects stale openers', async () => {
    const { api, unmount } = toolHarness();
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = api.open(toolRequest('first'));
      second = api.open(toolRequest('second'));
    });
    unmount();
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    await expect(api.open(toolRequest('late'))).resolves.toBe(false);
  });
});
