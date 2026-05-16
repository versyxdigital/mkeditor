// Phase 1 sanity check: confirms the React + shadcn + Tailwind build path.
// Side-effect imports keep the symbols reachable from `index.ts` so webpack
// compiles them and PostCSS scans the JSX for Tailwind class usage.
// Remove this file (and its import from index.ts) at the end of Phase 2.
import * as React from 'react';

import './styles/tailwind.css';
import { Button } from './components/ui/button';

export const __SanityProbe: React.FC = () => (
  <Button className="hidden" aria-hidden="true">
    sanity
  </Button>
);
