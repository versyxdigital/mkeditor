import * as React from 'react';

import type { MenuGroup, MenuItem } from '../../../app/lib/menuModel';
import { dispatchMenuActionExternal } from '../../menuDispatch';
import { cn } from '../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface TitleBarMenuProps {
  group: MenuGroup;
}

/**
 * One File / Edit / View / Help dropdown. The trigger renders the group
 * label as a small text button; the content lists items from the model
 * (separator handled via `separatorBefore`), with the accelerator label
 * pinned to the right.
 *
 * Click → `dispatchMenuActionExternal(item.action)` does the right
 * effect (channel send / Monaco role / main-process command). The whole
 * row is keyboard-navigable via Radix's built-in arrow-key handling.
 */
export const TitleBarMenu: React.FC<TitleBarMenuProps> = ({ group }) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'rounded-sm px-2 py-1 text-xs text-foreground',
          'hover:bg-accent hover:text-accent-foreground',
          'data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        )}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {group.label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        {group.items.map((item, idx) => (
          <MenuRow key={item.id} item={item} first={idx === 0} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const MenuRow: React.FC<{ item: MenuItem; first: boolean }> = ({
  item,
  first,
}) => {
  const accelerator = item.accelerator
    ? formatAccelerator(item.accelerator)
    : '';
  return (
    <>
      {item.separatorBefore && !first && <DropdownMenuSeparator />}
      <DropdownMenuItem
        disabled={!item.action}
        onSelect={() => {
          if (item.action) dispatchMenuActionExternal(item.action);
        }}
        className="flex items-center justify-between gap-6 text-xs"
      >
        <span>{item.label}</span>
        {accelerator && (
          <span className="text-[10px] text-muted-foreground">
            {accelerator}
          </span>
        )}
      </DropdownMenuItem>
    </>
  );
};

/**
 * Translate Electron's accelerator string into the form to display.
 * `CmdOrCtrl+N` → `Ctrl+N` (the in-window menu only shows on Windows/Linux
 * and web, where Ctrl is correct). macOS uses the native menu and never
 * reaches this code path.
 */
function formatAccelerator(accel: string): string {
  return accel.replace(/CmdOrCtrl/g, 'Ctrl').replace(/Cmd/g, '⌘');
}
