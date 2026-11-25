import * as React from 'react';
import type { CloudProviderId } from '../../../app/interfaces/Cloud';
import { cloudMessageKey } from '../../cloudLabels';
import { useTranslation } from './useTranslation';

export function useCloudTranslation(provider?: CloudProviderId) {
  const base = useTranslation();
  const t = React.useCallback(
    (key: string, values?: Record<string, unknown>) =>
      base.t(
        key.startsWith('cloud:')
          ? cloudMessageKey(key.slice('cloud:'.length), provider)
          : key,
        values,
      ),
    [base.t, base.language, provider],
  );
  return { ...base, t };
}
