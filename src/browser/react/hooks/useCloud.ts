import * as React from 'react';
import { EMPTY_CLOUD } from '../../core/CloudManager';
import { useManagers } from '../contexts/ManagersContext';

const emptySubscribe = () => () => {};

const emptySnapshot = () => EMPTY_CLOUD;

export function useCloud() {
  const { bridgeManager, mode } = useManagers();
  const manager = mode === 'desktop' ? bridgeManager?.cloudManager : undefined;
  const state = React.useSyncExternalStore(
    manager?.subscribe ?? emptySubscribe,
    manager?.getSnapshot ?? emptySnapshot,
  );
  React.useEffect(() => {
    manager?.initialize();
  }, [manager]);
  return { manager, state };
}
