import * as React from 'react';

import { ManagersProvider, type Managers } from './contexts/ManagersContext';
import { EditorHost } from './components/EditorHost';
import { LegacyShell } from './components/LegacyShell';

import './styles/tailwind.css';

export interface AppProps {
  managers: Managers;
  /** Fires once after Monaco is created (forwarded from <EditorHost>). */
  onEditorReady?: () => void;
}

export const App: React.FC<AppProps> = ({ managers, onEditorReady }) => (
  <ManagersProvider value={managers}>
    <LegacyShell />
    <EditorHost onReady={onEditorReady} />
  </ManagersProvider>
);
