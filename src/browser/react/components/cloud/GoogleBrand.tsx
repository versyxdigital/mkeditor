import * as React from 'react';
import { cn } from '../../lib/utils';

/** Official, unmodified Google assets are bundled for offline desktop use. */
export const GoogleDriveLogo: React.FC<{ className?: string }> = ({
  className,
}) => (
  <img
    src="./google-drive.png"
    alt=""
    aria-hidden="true"
    draggable={false}
    className={cn('h-4 w-4 shrink-0 object-contain', className)}
  />
);

export const GoogleLogo: React.FC<{ className?: string }> = ({ className }) => (
  <img
    src="./google.png"
    alt=""
    aria-hidden="true"
    draggable={false}
    className={cn('h-[18px] w-[18px] shrink-0 object-contain', className)}
  />
);
