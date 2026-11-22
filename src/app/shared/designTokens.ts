/** Shared colour values for application CSS, Monaco and standalone documents. */
export const lightPalette = {
  'bg-app': '#F5F6F8',
  'bg-sidebar': '#F0F2F5',
  'bg-editor': '#FFFFFF',
  'bg-preview': '#FFFFFF',
  'bg-elevated': '#FFFFFF',
  'bg-hover': '#E8ECF2',
  'bg-active': '#D8EAE5',
  'text-primary': '#252A32',
  'text-secondary': '#596271',
  'text-muted': '#6C7583',
  'border-default': '#D9DEE6',
  'border-subtle': '#E7EAF0',
  'border-control': '#808A98',
  'accent-primary': '#397B71',
  'accent-hover': '#2D655D',
  'accent-subtle': '#E1F0EC',
  'text-on-accent': '#FFFFFF',
  'status-success': '#247044',
  'status-warning': '#865C12',
  'status-error': '#B53636',
} as const;

export type ThemePalette = Record<keyof typeof lightPalette, string>;

export const darkPalette: ThemePalette = {
  'bg-app': '#181A1D',
  'bg-sidebar': '#1E2024',
  'bg-editor': '#202226',
  'bg-preview': '#202226',
  'bg-elevated': '#292C31',
  'bg-hover': '#30343A',
  'bg-active': '#2C413B',
  'text-primary': '#E6E8EB',
  'text-secondary': '#A5ABB4',
  'text-muted': '#777F8B',
  'border-default': '#34383E',
  'border-subtle': '#2B2E33',
  'border-control': '#748095',
  'accent-primary': '#83BEB1',
  'accent-hover': '#A0D1C6',
  'accent-subtle': '#213A35',
  'text-on-accent': '#181A1D',
  'status-success': '#88C99D',
  'status-warning': '#E2BD74',
  'status-error': '#F18D8D',
};

/** Only new/missing preferences use these defaults; stored values win. */
export const documentDefaults = {
  fontSize: 16,
  lineSpacing: 1.7,
  background: lightPalette['bg-preview'],
  fontColor: lightPalette['text-primary'],
};

export const interfaceFont =
  'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export function paletteVariables(palette: ThemePalette): string {
  return Object.entries(palette)
    .map(([name, value]) => `--${name}: ${value};`)
    .join('\n');
}
