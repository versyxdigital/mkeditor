import Swal from 'sweetalert2';
import type { ContextBridgeAPI } from '../../interfaces/Bridge';
import type { TreeNode } from '../FileTreeManager';
import { withMdExtension } from '../../util';
import { t } from '../../i18n';

export interface ContextMenuItem {
  label: string;
  action: () => void;
  divider?: boolean;
}

export interface ContextMenuCallbacks {
  openFile: (path: string) => void;
  /** Called by the "Collapse explorer" / "Expand folder" items. */
  toggleSidebar: () => void;
  /** Called by the "Open settings" item; triggers the (still-Bootstrap) modal. */
  openSettings: () => void;
  /** Called by the "Expand folder" item to flip a directory's local expand state. */
  expandFolder?: (path: string) => void;
}

/**
 * Build the explorer right-click menu items for a given node (or null
 * for an empty-tree / background right-click). Items are plain data
 * `{ label, action, divider }` — `<ExplorerContextMenu>` renders them
 * via shadcn's ContextMenu primitives.
 *
 * SweetAlert2 prompts inside the file/folder rename/new/delete actions
 * stay here until Phase 8 swaps SweetAlert2 for shadcn AlertDialog.
 */
export function getContextMenuItems(
  bridge: ContextBridgeAPI,
  treeRoot: string | null,
  node: TreeNode | null,
  callbacks: ContextMenuCallbacks,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const { openFile, toggleSidebar, openSettings, expandFolder } = callbacks;

  if (!node) {
    // Empty-tree / background area.
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
    items.push(
      {
        label: t('menus-explorer:collapse_explorer'),
        action: toggleSidebar,
      },
      {
        label: t('menus-explorer:open_settings'),
        action: openSettings,
      },
    );
    return items;
  }

  if (node.type === 'file') {
    const { path } = node;
    items.push(
      {
        label: t('menus-explorer:open_file'),
        action: () => openFile(path),
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
        action: toggleSidebar,
      },
      {
        label: t('menus-explorer:open_settings'),
        action: openSettings,
      },
    );
    return items;
  }

  // Directory
  const { path } = node;
  items.push(
    {
      label: t('menus-explorer:expand_folder'),
      action: () => expandFolder?.(path),
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
      action: toggleSidebar,
    },
    {
      label: t('menus-explorer:open_settings'),
      action: openSettings,
    },
  );

  return items;
}
