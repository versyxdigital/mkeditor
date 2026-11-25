import * as React from 'react';
import { EMPTY_CLOUD } from '../../core/CloudManager';
import { useManagers } from '../contexts/ManagersContext';

const emptySubscribe = () => () => {};

const emptySnapshot = () => EMPTY_CLOUD;

export function useCloud() {
  const { bridgeManager } = useManagers();
  const manager = bridgeManager?.cloudManager;
  const state = React.useSyncExternalStore(
    manager?.subscribe ?? emptySubscribe,
    manager?.getSnapshot ?? emptySnapshot,
  );
  React.useEffect(() => {
    manager?.initialize();
  }, [manager]);
  return { manager, state };
}
