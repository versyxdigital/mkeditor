import * as React from 'react';
import type { CloudProviderId } from '../../../../app/interfaces/Cloud';
import { GoogleDriveLogo } from './GoogleBrand';
import { cn } from '../../lib/utils';

/** Dropbox's standard box mark; shared across storage, document and tab UI. */
export const DropboxLogo: React.FC<{ className?: string }> = ({
  className,
}) => (
  <img
    src="./dropbox.svg"
    alt=""
    aria-hidden="true"
    draggable={false}
    className={cn('h-4 w-4 shrink-0 object-contain', className)}
  />
);

export const CloudLogo: React.FC<{
  provider?: CloudProviderId;
  className?: string;
}> = ({ provider, className }) =>
  provider === 'dropbox' ? (
    <DropboxLogo className={className} />
  ) : (
    <GoogleDriveLogo className={className} />
  );
