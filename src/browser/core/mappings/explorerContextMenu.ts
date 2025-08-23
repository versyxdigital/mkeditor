import Swal from 'sweetalert2';
import type { ContextBridgeAPI } from '../../interfaces/Bridge';
import { withMdExtension } from '../../util';
import { dom } from '../../dom';

interface ContextMenuItem {
  label: string;
  action: () => void;
  divider?: boolean;
}

export function getContextMenuItems(
  bridge: ContextBridgeAPI,
  treeRoot: string | null,
  li: HTMLElement | null,
  openFile: (path: string) => void,
) {
  const items: ContextMenuItem[] = [];

  if (!li) {
    if (treeRoot) {
      items.push(
        {
          label: 'New File',
          action: async () => {
            const result = await Swal.fire({
              title: 'New file name',
              input: 'text',
              inputPlaceholder: 'Untitled.md',
              showCancelButton: true,
              customClass: {
                popup: ['rounded', 'shadow'],
                actions: 'mt-2',
                input: 'small',
              },
            });
            if (result.isConfirmed && result.value) {
              bridge.send('to:file:create', {
                parent: treeRoot,
                name: withMdExtension(result.value),
              });
            }
          },
        },
        {
          label: 'New Folder',
          action: async () => {
            const result = await Swal.fire({
              title: 'New folder name',
              input: 'text',
              showCancelButton: true,
              customClass: {
                popup: ['rounded', 'shadow'],
                actions: 'mt-2',
                input: 'small',
              },
            });
            if (result.isConfirmed && result.value) {
              bridge.send('to:folder:create', {
                parent: treeRoot,
                name: result.value,
              });
            }
          },
        },
        { divider: true, label: '', action: () => {} },
        {
          label: 'Collapse Explorer',
          action: () => {
            dom.buttons.sidebar.click();
          },
        },
        {
          label: 'Open Settings',
          action: () => {
            dom.buttons.settings.click();
          },
        },
      );
    }
  } else if (li.classList.contains('file') && li.dataset.path) {
    const path = li.dataset.path;
    items.push(
      {
        label: 'Open File',
        action: () => {
          openFile(path);
        },
      },
      {
        label: 'Rename File...',
        action: async () => {
          const result = await Swal.fire({
            title: 'Rename file',
            input: 'text',
            inputValue: path.split(/[/\\]/).pop(),
            showCancelButton: true,
            customClass: {
              popup: ['rounded', 'shadow'],
              actions: 'mt-2',
              input: 'small',
            },
          });
          if (result.isConfirmed && result.value) {
            bridge.send('to:file:rename', {
              path,
              name: withMdExtension(result.value),
            });
          }
        },
      },
      {
        label: 'Delete File...',
        action: async () => {
          const confirm = await Swal.fire({
            title: 'Delete file?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Delete',
            customClass: {
              popup: ['rounded', 'shadow'],
              actions: 'mt-2',
            },
          });
          if (confirm.isConfirmed) {
            bridge.send('to:file:delete', { path });
          }
        },
      },
      {
        label: 'Show Properties...',
        action: () => {
          bridge.send('to:file:properties', { path });
        },
      },
      { divider: true, label: '', action: () => {} },
      {
        label: 'Collapse Explorer',
        action: () => {
          dom.buttons.sidebar.click();
        },
      },
      {
        label: 'Open Settings...',
        action: () => {
          dom.buttons.settings.click();
        },
      },
    );
  } else if (li.classList.contains('directory') && li.dataset.path) {
    const path = li.dataset.path;
    items.push(
      {
        label: 'Open Folder',
        action: () => {
          const span = li.querySelector(':scope > span.file-name');
          const ul = li.querySelector(':scope > ul') as HTMLElement | null;
          if (span && ul && ul.style.display === 'none') {
            span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
        },
      },
      {
        label: 'Rename Folder...',
        action: async () => {
          const result = await Swal.fire({
            title: 'Rename folder',
            input: 'text',
            inputValue: path.split(/[/\\]/).pop(),
            showCancelButton: true,
          });
          if (result.isConfirmed && result.value) {
            bridge.send('to:file:rename', { path, name: result.value });
          }
        },
      },
      {
        label: 'Delete Folder...',
        action: async () => {
          const confirm = await Swal.fire({
            title: 'Delete folder?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Delete',
          });
          if (confirm.isConfirmed) {
            bridge.send('to:file:delete', { path });
          }
        },
      },
      {
        label: 'Show Properties...',
        action: () => {
          bridge.send('to:file:properties', { path });
        },
      },
      { divider: true, label: '', action: () => {} },
      {
        label: 'Collapse Explorer',
        action: () => {
          dom.buttons.sidebar.click();
        },
      },
      {
        label: 'Open Settings...',
        action: () => {
          dom.buttons.settings.click();
        },
      },
    );
  }

  return items;
}
