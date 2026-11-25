import * as React from 'react';
import type { CloudConnection } from '../../../../app/interfaces/Cloud';
import { providerName } from '../../../../app/interfaces/Cloud';
import { useCloud } from '../../hooks/useCloud';
import { useCloudTranslation } from '../../hooks/useCloudTranslation';
import { useModals } from '../../contexts/ModalsContext';
import { Button } from '../ui/button';
import { Icon } from '../Icon';
import { CloudLogo } from './CloudBrand';

/** Reuse a remembered connection without creating another account entry. */
export const CloudReconnectButton: React.FC<{
  connection: CloudConnection;
  compact?: boolean;
}> = ({ connection, compact = false }) => {
  const { manager, state } = useCloud();
  const { t } = useCloudTranslation(connection.provider);
  const { openModal } = useModals();
  const busy =
    state.busy.includes(connection.id) || connection.status === 'connecting';
  const label = t('cloud:web_reconnect', {
    provider: providerName(connection.provider),
  });
  return (
    <Button
      size="sm"
      variant={compact ? 'ghost' : 'outline'}
      className="h-7 max-w-full shrink-0 gap-2 px-2 text-xs"
      title={label}
      aria-label={label}
      aria-busy={busy}
      disabled={
        !manager ||
        busy ||
        !state.secureStorage ||
        !(connection.provider === 'dropbox'
          ? state.dropboxAvailable
          : state.googleDriveAvailable)
      }
      onClick={() => {
        void manager
          ?.run({ action: 'connect', connectionId: connection.id })
          .then((ok) => {
            if (!ok) openModal('settings', { tab: 'connections' });
          });
      }}
    >
      {busy ? (
        <Icon
          name="refresh"
          className="size-3.5 animate-spin motion-reduce:animate-none"
        />
      ) : !compact ? (
        <CloudLogo provider={connection.provider} />
      ) : null}
      <span className="truncate">
        {busy
          ? t('cloud:status_connecting')
          : compact
            ? t('cloud:reconnect')
            : label}
      </span>
    </Button>
  );
};
