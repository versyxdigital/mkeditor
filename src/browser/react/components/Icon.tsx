import * as React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconProp } from '@fortawesome/fontawesome-svg-core';

/**
 * Thin shim over `@fortawesome/react-fontawesome` per the Decisions
 * table's note about keeping FontAwesome behind a wrapper.
 *
 * Why this exists: FontAwesome SVG core's global `dom.watch()` (set up
 * in `src/browser/icons.ts`) replaces `<i class="fa fa-...">` elements
 * with `<svg>` elements via MutationObserver. That works for static
 * legacy DOM, but it fights React's reconciliation for any icon whose
 * className changes between renders (the chevron in <FileTreePanel>
 * was the canary): React holds a ref to an `<i>` element that
 * FontAwesome has already swapped out, so subsequent className updates
 * never reach the live SVG. Worse, the post-swap DOM mismatch can
 * break event handlers further up the tree.
 *
 * `<FontAwesomeIcon>` renders the SVG directly through React, so it
 * never enters the MutationObserver swap path.
 *
 * Pass a `name` (e.g. `"chevron-right"`) and an optional `style` prefix
 * (`"fas"` solid by default). Library registration still happens in
 * `src/browser/icons.ts`; this wrapper only needs the icon to be in
 * the library.
 */
export interface IconProps {
  name: string;
  style?: 'fas' | 'far' | 'fab';
  className?: string;
  ariaHidden?: boolean;
}

export const Icon: React.FC<IconProps> = ({
  name,
  style = 'fas',
  className,
  ariaHidden = true,
}) => (
  <FontAwesomeIcon
    icon={[style, name] as IconProp}
    className={className}
    aria-hidden={ariaHidden}
  />
);
