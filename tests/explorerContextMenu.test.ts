import { getContextMenuItems } from '../src/browser/core/mappings/explorerContextMenu';

describe('explorer context menu', () => {
  it('includes new file and folder options for directories', () => {
    const bridge = { send: jest.fn() } as any;
    const li = document.createElement('li');
    li.classList.add('ft-node', 'directory');
    li.dataset.path = '/tmp';

    const items = getContextMenuItems(bridge, '/tmp', li, jest.fn());
    const labels = items.map((i) => i.label);

    expect(labels).toContain('New File');
    expect(labels).toContain('New Folder');
  });
});
