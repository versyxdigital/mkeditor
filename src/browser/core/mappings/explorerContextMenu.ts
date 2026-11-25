import type { ContextBridgeAPI } from '../../interfaces/Bridge';
import type { TreeNode } from '../FileTreeManager';
import {
  confirmExternal,
  promptExternal,
} from '../../react/contexts/PromptsContext';
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
  /** Called by the "Open settings" item; opens the React Settings modal. */
  openSettings: () => void;
  /** Called by the "Expand folder" item to flip a directory's local expand state. */
  expandFolder?: (path: string) => void;
  /**
   * Called by the "Move to…" item.
   */
  openMoveItem?: (path: string) => void;
}

/**
 * Build the explorer right-click menu items for a given node (or null
 * for an empty-tree / background right-click). Items are plain data
 * `{ label, action, divider }`.
 */
export function getContextMenuItems(
  bridge: ContextBridgeAPI,
  treeRoot: string | null,
  node: TreeNode | null,
  callbacks: ContextMenuCallbacks,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const { openFile, toggleSidebar, openSettings, expandFolder, openMoveItem } =
    callbacks;

  const promptNewFile = async (parent: string) => {
    const name = await promptExternal({
      title: t('menus-explorer:prompt_new_file_title'),
      placeholder: t('menus-explorer:prompt_new_file_placeholder'),
      confirmLabel: t('menus-explorer:prompt_save'),
      cancelLabel: t('menus-explorer:prompt_cancel'),
    });
    if (name) {
      bridge.send('to:file:create', {
        parent,
        name: withMdExtension(name),
      });
    }
  };

  const promptNewFolder = async (parent: string) => {
    const name = await promptExternal({
      title: t('menus-explorer:prompt_new_folder_title'),
      confirmLabel: t('menus-explorer:prompt_save'),
      cancelLabel: t('menus-explorer:prompt_cancel'),
    });
    if (name) {
      bridge.send('to:folder:create', { parent, name });
    }
  };

  const promptRename = async (
    path: string,
    titleKey: string,
    mdExtension: boolean,
  ) => {
    const current = path.split(/[/\\]/).pop() ?? '';
    const name = await promptExternal({
      title: t(titleKey),
      defaultValue: current,
      confirmLabel: t('menus-explorer:prompt_save'),
      cancelLabel: t('menus-explorer:prompt_cancel'),
    });
    if (name) {
      bridge.send('to:file:rename', {
        path,
        name: mdExtension ? withMdExtension(name) : name,
      });
    }
  };

  const confirmDelete = async (path: string, titleKey: string) => {
    const ok = await confirmExternal({
      title: t(titleKey),
      confirmLabel: t('menus-explorer:confirm_delete_button'),
      cancelLabel: t('menus-explorer:prompt_cancel'),
      destructive: true,
    });
    if (ok) {
      bridge.send('to:file:delete', { path });
    }
  };

  if (!node) {
    // Empty-tree / background area.
    if (treeRoot) {
      items.push(
        {
          label: t('menus-explorer:new_file'),
          action: () => void promptNewFile(treeRoot),
        },
        {
          label: t('menus-explorer:new_folder'),
          action: () => void promptNewFolder(treeRoot),
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
        action: () =>
          void promptRename(
            path,
            'menus-explorer:prompt_rename_file_title',
            true,
          ),
      },
      {
        label: t('menus-explorer:move_to'),
        action: () => openMoveItem?.(path),
      },
      {
        label: t('menus-explorer:delete_file'),
        action: () =>
          void confirmDelete(path, 'menus-explorer:confirm_delete_file_title'),
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
      action: () => void promptNewFile(path),
    },
    {
      label: t('menus-explorer:new_folder'),
      action: () => void promptNewFolder(path),
    },
    { divider: true, label: '', action: () => {} },
    {
      label: t('menus-explorer:rename_folder'),
      action: () =>
        void promptRename(
          path,
          'menus-explorer:prompt_rename_folder_title',
          false,
        ),
    },
    {
      label: t('menus-explorer:move_to'),
      action: () => openMoveItem?.(path),
    },
    {
      label: t('menus-explorer:delete_folder'),
      action: () =>
        void confirmDelete(path, 'menus-explorer:confirm_delete_folder_title'),
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
