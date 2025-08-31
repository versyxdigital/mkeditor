import Swal from 'sweetalert2';
import type { ContextBridgeAPI } from '../../interfaces/Bridge';
import { withMdExtension } from '../../util';
import { dom } from '../../dom';
import { t } from '../../i18n';

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
          label: t('menus-explorer:new_file'),
          action: async () => {
            const result = await Swal.fire({
              title: t('menus-explorer:prompt_new_file_title'),
              input: 'text',
              inputPlaceholder: t('menus-explorer:prompt_new_file_placeholder'),
              showCancelButton: true,
              draggable: true,
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
          label: t('menus-explorer:new_folder'),
          action: async () => {
            const result = await Swal.fire({
              title: t('menus-explorer:prompt_new_folder_title'),
              input: 'text',
              showCancelButton: true,
              draggable: true,
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
      );
    } else {
      items.push(
        {
          label: t('menus-explorer:open_folder'),
          action: () => {
            bridge.send('to:folder:open', true);
          },
        },
        { divider: true, label: '', action: () => {} },
      );
    }
    // Defaults
    items.push(
      {
        label: t('menus-explorer:collapse_explorer'),
        action: () => {
          dom.buttons.sidebar.click();
        },
      },
      {
        label: t('menus-explorer:open_settings'),
        action: () => {
          dom.buttons.settings.click();
        },
      },
    );
  } else if (li.classList.contains('file') && li.dataset.path) {
    const path = li.dataset.path;
    items.push(
      {
        label: t('menus-explorer:open_file'),
        action: () => {
          openFile(path);
        },
      },
      { divider: true, label: '', action: () => {} },
      {
        label: t('menus-explorer:rename_file'),
        action: async () => {
          const result = await Swal.fire({
            title: t('menus-explorer:prompt_rename_file_title'),
            input: 'text',
            inputValue: path.split(/[/\\]/).pop(),
            showCancelButton: true,
            draggable: true,
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
        label: t('menus-explorer:delete_file'),
        action: async () => {
          const confirm = await Swal.fire({
            title: t('menus-explorer:confirm_delete_file_title'),
            icon: 'warning',
            showCancelButton: true,
            draggable: true,
            confirmButtonText: t('menus-explorer:confirm_delete_button'),
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
      { divider: true, label: '', action: () => {} },
      {
        label: t('menus-explorer:show_properties'),
        action: () => {
          bridge.send('to:file:properties', { path });
        },
      },
      { divider: true, label: '', action: () => {} },
      {
        label: t('menus-explorer:collapse_explorer'),
        action: () => {
          dom.buttons.sidebar.click();
        },
      },
      {
        label: t('menus-explorer:open_settings'),
        action: () => {
          dom.buttons.settings.click();
        },
      },
    );
  } else if (li.classList.contains('directory') && li.dataset.path) {
    const path = li.dataset.path;
    items.push(
      {
        label: t('menus-explorer:expand_folder'),
        action: () => {
          const span = li.querySelector(':scope > span.file-name');
          const ul = li.querySelector(':scope > ul') as HTMLElement | null;
          if (span && ul && ul.style.display === 'none') {
            span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
        },
      },
      { divider: true, label: '', action: () => {} },
      {
        label: t('menus-explorer:new_file'),
        action: async () => {
          const result = await Swal.fire({
            title: t('menus-explorer:prompt_new_file_title'),
            input: 'text',
            inputPlaceholder: t('menus-explorer:prompt_new_file_placeholder'),
            showCancelButton: true,
            draggable: true,
            customClass: {
              popup: ['rounded', 'shadow'],
              actions: 'mt-2',
              input: 'small',
            },
          });
          if (result.isConfirmed && result.value) {
            bridge.send('to:file:create', {
              parent: path,
              name: withMdExtension(result.value),
            });
          }
        },
      },
      {
        label: t('menus-explorer:new_folder'),
        action: async () => {
          const result = await Swal.fire({
            title: t('menus-explorer:prompt_new_folder_title'),
            input: 'text',
            showCancelButton: true,
            draggable: true,
            customClass: {
              popup: ['rounded', 'shadow'],
              actions: 'mt-2',
              input: 'small',
            },
          });
          if (result.isConfirmed && result.value) {
            bridge.send('to:folder:create', {
              parent: path,
              name: result.value,
            });
          }
        },
      },
      { divider: true, label: '', action: () => {} },
      {
        label: t('menus-explorer:rename_folder'),
        action: async () => {
          const result = await Swal.fire({
            title: t('menus-explorer:prompt_rename_folder_title'),
            input: 'text',
            inputValue: path.split(/[/\\]/).pop(),
            showCancelButton: true,
            draggable: true,
            customClass: {
              popup: ['rounded', 'shadow'],
              actions: 'mt-2',
              input: 'small',
            },
          });
          if (result.isConfirmed && result.value) {
            bridge.send('to:file:rename', { path, name: result.value });
          }
        },
      },
      {
        label: t('menus-explorer:delete_folder'),
        action: async () => {
          const confirm = await Swal.fire({
            title: t('menus-explorer:confirm_delete_folder_title'),
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: t('menus-explorer:confirm_delete_button'),
            draggable: true,
            customClass: {
              popup: ['rounded', 'shadow'],
              actions: 'mt-2',
              input: 'small',
            },
          });
          if (confirm.isConfirmed) {
            bridge.send('to:file:delete', { path });
          }
        },
      },
      { divider: true, label: '', action: () => {} },
      {
        label: t('menus-explorer:show_properties'),
        action: () => {
          bridge.send('to:file:properties', { path });
        },
      },
      { divider: true, label: '', action: () => {} },
      {
        label: t('menus-explorer:collapse_explorer'),
        action: () => {
          dom.buttons.sidebar.click();
        },
      },
      {
        label: t('menus-explorer:open_settings'),
        action: () => {
          dom.buttons.settings.click();
        },
      },
    );
  }

  return items;
}
