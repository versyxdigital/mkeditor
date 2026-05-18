import * as React from 'react';

import { menuModel } from '../../../app/lib/menuModel';
import { useManagers } from '../contexts/ManagersContext';
import { useWindowControls } from '../contexts/WindowContext';
import { cn } from '../lib/utils';
import { TitleBarMenu } from './TitleBar.menu';

/**
 * VSCode-style in-window title bar.
 *
 * Layout: logo · menu buttons (one per `MenuGroup`) · flex spacer · window
 * controls (min / max-or-restore / close).
 *
 * Visibility:
 *   - macOS desktop: not rendered. The native menu lives on the system bar
 *     and the traffic lights handle window controls.
 *   - Windows/Linux desktop: full bar with drag region + window controls.
 *   - Web: not rendered. The browser supplies its own window chrome, and
 *     File/Edit/View/Help are a desktop-only concept — web users reach the
 *     equivalent actions via the Navbar, Sidebar, EditorToolbar, and
 *     Monaco keybindings.
 */
export const TitleBar: React.FC = () => {
  const { mode, platform } = useManagers();
  const { maximize: toggleMaximize } = useWindowControls();
  const navRef = React.useRef<HTMLElement | null>(null);

  // macOS: leave the strip empty so the native menu and traffic lights
  // stay the source of truth. `titleBarStyle: 'hiddenInset'` already
  // reserved the vertical space; the rest of the app sits below.
  if (platform === 'darwin' && mode === 'desktop') return null;

  // Web: no in-window title bar at all.
  if (mode === 'web') return null;

  const isDesktop = mode === 'desktop';

  // Alt opens the first menu (mirrors VSCode / native menu-bar UX).
  // Left/Right cycling between open menus is handled by Radix once the
  // user is inside the menu strip; this hook just gets them in.
  React.useEffect(() => {
    if (!isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // Don't grab Alt while the user is typing in an input/textarea or
      // inside Monaco — the editor needs Alt for its own bindings.
      const target = e.target instanceof Element ? e.target : null;
      const inEditableField =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          (target as HTMLElement).isContentEditable ||
          target.closest(
            '[contenteditable=""], [contenteditable="true"], .monaco-editor',
          ) !== null);
      if (inEditableField) return;
      const first = navRef.current?.querySelector<HTMLButtonElement>(
        'button[data-titlebar-menu]',
      );
      if (first) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktop]);

  // Double-clicking the drag region toggles maximize/restore — same
  // gesture every OS uses on its native title bar. Only fires on
  // desktop; web's title bar has no concept of maximize.
  const onDragRegionDoubleClick = isDesktop
    ? (e: React.MouseEvent<HTMLDivElement>) => {
        // Ignore double-clicks that originated on a `no-drag` child
        // (menu buttons, window controls); those bubble up but aren't
        // real drag-region interactions.
        const target = e.target as HTMLElement;
        if (target.closest('[data-titlebar-no-drag]')) return;
        toggleMaximize();
      }
    : undefined;

  return (
    <div
      data-testid="title-bar"
      className={cn(
        'flex h-8 select-none items-center gap-1 border-b border-border bg-background pl-2 pr-0 text-xs',
      )}
      style={
        isDesktop ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : {}
      }
      onDoubleClick={onDragRegionDoubleClick}
    >
      <img
        src="./icon.png"
        alt=""
        className="mr-1 h-4 w-4"
        data-titlebar-no-drag
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      />
      <nav
        ref={navRef}
        className="flex items-center gap-px"
        data-titlebar-no-drag
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onKeyDown={cycleMenuTriggers}
      >
        {menuModel.map((group) => (
          <TitleBarMenu key={group.id} group={group} />
        ))}
      </nav>
      <div className="flex-1" />
      {isDesktop && <WindowControlButtons />}
    </div>
  );
};

/**
 * ArrowLeft / ArrowRight cycle focus between menu-bar triggers while the
 * dropdown is closed (matches the VSCode keyboard model). Home/End jump
 * to the first / last. When a dropdown is *open*, Radix owns the keys
 * — its built-in arrow handling moves through menu items vertically.
 */
function cycleMenuTriggers(e: React.KeyboardEvent<HTMLElement>): void {
  if (
    e.key !== 'ArrowLeft' &&
    e.key !== 'ArrowRight' &&
    e.key !== 'Home' &&
    e.key !== 'End'
  ) {
    return;
  }
  const target = e.target as HTMLElement;
  if (!target.matches('button[data-titlebar-menu]')) return;
  const triggers = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>(
      'button[data-titlebar-menu]',
    ),
  );
  const idx = triggers.indexOf(target as HTMLButtonElement);
  if (idx < 0) return;
  let nextIdx = idx;
  switch (e.key) {
    case 'ArrowLeft':
      nextIdx = (idx - 1 + triggers.length) % triggers.length;
      break;
    case 'ArrowRight':
      nextIdx = (idx + 1) % triggers.length;
      break;
    case 'Home':
      nextIdx = 0;
      break;
    case 'End':
      nextIdx = triggers.length - 1;
      break;
  }
  e.preventDefault();
  triggers[nextIdx]?.focus();
}

const WindowControlButtons: React.FC = () => {
  const { isMaximized, minimize, maximize, close } = useWindowControls();

  return (
    <div
      className="flex h-full items-stretch"
      data-titlebar-no-drag
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <ControlButton ariaLabel="Minimize" onClick={minimize}>
        <MinimizeIcon />
      </ControlButton>
      <ControlButton
        ariaLabel={isMaximized ? 'Restore' : 'Maximize'}
        onClick={maximize}
      >
        {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
      </ControlButton>
      <ControlButton ariaLabel="Close" onClick={close} variant="close">
        <CloseIcon />
      </ControlButton>
    </div>
  );
};

const ControlButton: React.FC<{
  ariaLabel: string;
  onClick: () => void;
  variant?: 'default' | 'close';
  children: React.ReactNode;
}> = ({ ariaLabel, onClick, variant = 'default', children }) => (
  <button
    type="button"
    aria-label={ariaLabel}
    onClick={onClick}
    className={cn(
      'flex w-11 items-center justify-center text-foreground',
      variant === 'close'
        ? 'hover:bg-red-600 hover:text-white'
        : 'hover:bg-accent hover:text-accent-foreground',
      'focus:outline-none focus-visible:bg-accent',
    )}
  >
    {children}
  </button>
);

const ICON_PROPS = {
  width: 10,
  height: 10,
  viewBox: '0 0 10 10',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1,
  'aria-hidden': true,
} as const;

const MinimizeIcon: React.FC = () => (
  <svg {...ICON_PROPS}>
    <path d="M0 5 H10" />
  </svg>
);

const MaximizeIcon: React.FC = () => (
  <svg {...ICON_PROPS}>
    <rect x="0.5" y="0.5" width="9" height="9" />
  </svg>
);

const RestoreIcon: React.FC = () => (
  <svg {...ICON_PROPS}>
    {/* Back square (top-right) and front square (bottom-left) offset by 2px. */}
    <rect x="2.5" y="0.5" width="7" height="7" />
    <rect x="0.5" y="2.5" width="7" height="7" fill="var(--background)" />
  </svg>
);

const CloseIcon: React.FC = () => (
  <svg {...ICON_PROPS}>
    <path d="M0 0 L10 10 M10 0 L0 10" />
  </svg>
);
