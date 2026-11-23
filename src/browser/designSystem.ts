import {
  lightPalette,
  darkPalette,
  paletteVariables,
  interfaceFont,
} from '../app/shared/designTokens';

/** Injected before React mounts; Tailwind and legacy SCSS consume the same tokens. */
export const designSystemStylesheet = `
:root {
  ${paletteVariables(lightPalette)}
  --font-interface: ${interfaceFont};
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px; --space-12: 48px;
  --toolbar-height: 32px; --footer-height: 38px; --tab-height: 36px;
  --control-height: 32px; --input-height: 34px; --sidebar-row-height: 30px;
  --radius-control: 6px; --radius-floating: 8px; --radius-dialog: 10px;
  --motion-hover: 120ms; --motion-panel: 160ms;
  --shadow-floating: 0 4px 16px #181a1d14, 0 1px 3px #181a1d0d;
}
[data-theme='dark'] {
  ${paletteVariables(darkPalette)}
  --shadow-floating: 0 8px 24px #00000030, 0 1px 4px #00000024;
}
`;
