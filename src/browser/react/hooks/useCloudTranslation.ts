import * as React from 'react';
import type { CloudProviderId } from '../../../app/interfaces/Cloud';
import { cloudMessageKey } from '../../cloudLabels';
import { useTranslation } from './useTranslation';
import { useManagers } from '../contexts/ManagersContext';

export function useCloudTranslation(provider?: CloudProviderId) {
  const base = useTranslation();
  const { mode } = useManagers();
  const t = React.useCallback(
    (key: string, values?: Record<string, unknown>) =>
      base.t(
        mode === 'web' && key === 'cloud:error_storage'
          ? 'cloud:web_storage_error'
          : mode === 'web' && key === 'cloud:status_reauthorize'
            ? 'cloud:web_reconnect_status'
            : key.startsWith('cloud:')
              ? cloudMessageKey(key.slice('cloud:'.length), provider)
              : key,
        values,
      ),
    [base.t, base.language, provider, mode],
  );
  return { ...base, t };
}
