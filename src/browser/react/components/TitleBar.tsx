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
 *   - Web: logo + menu only. The browser already supplies window chrome,
 *     and `-webkit-app-region` is a no-op outside Electron anyway.
 */
export const TitleBar: React.FC = () => {
  const { mode, platform } = useManagers();

  // macOS: leave the strip empty so the native menu and traffic lights
  // stay the source of truth. `titleBarStyle: 'hiddenInset'` already
  // reserved the vertical space; the rest of the app sits below.
  if (platform === 'darwin' && mode === 'desktop') return null;

  const isDesktop = mode === 'desktop';

  return (
    <div
      data-testid="title-bar"
      className={cn(
        'flex h-8 select-none items-center gap-1 border-b border-border bg-background pl-2 pr-0 text-xs',
      )}
      style={
        isDesktop ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : {}
      }
    >
      <img
        src="./icon.png"
        alt=""
        className="mr-1 h-4 w-4"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      />
      <nav
        className="flex items-center gap-px"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
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

const WindowControlButtons: React.FC = () => {
  const { isMaximized, minimize, maximize, close } = useWindowControls();

  return (
    <div
      className="flex h-full items-stretch"
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
