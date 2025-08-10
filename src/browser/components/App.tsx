import React from 'react';
import SplashScreen from './SplashScreen';
import SubMenuBar from './SubMenuBar';
import EditorLayout from './EditorLayout';
import SettingsModal from './modals/SettingsModal';
import AboutModal from './modals/AboutModal';
import ShortcutsModal from './modals/ShortcutsModal';

export default function App() {
  return (
    <>
      <SplashScreen />
      <SubMenuBar />
      <EditorLayout />
      <SettingsModal />
      <AboutModal />
      <ShortcutsModal />
    </>
  );
}
