import type { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import type { EditorProviders } from '../interfaces/Providers';
import { logger } from '../util';
import { dom } from '../dom';

/**
 * Register click handlers for buttons that still live in legacy DOM
 * (Bootstrap modals). Phase 6 moved the bottom-toolbar buttons
 * (save markdown, export-to-HTML, export-to-PDF, delete content) into
 * the React `<EditorToolbar>`. The three handlers below — save settings,
 * save export settings, and reset export settings — target buttons
 * inside the still-Bootstrap `#app-settings` / `#export-settings`
 * modals and stay here until Phase 7 replaces those modals with
 * shadcn dialogs.
 */
export function registerUIToolbarListeners(
  _mkeditor: editor.IStandaloneCodeEditor | null,
  providers: EditorProviders,
) {
  const logError = (id: string) => {
    logger?.error(
      'EditorManager.registerUIToolbarListeners',
      `${id} DOM handle not found, event listener not registered.`,
    );
  };

  if (dom.buttons.save.settings) {
    dom.buttons.save.settings.addEventListener('click', (event) => {
      event.preventDefault();
      const { bridge, settings, exportSettings } = providers;
      if (bridge && settings && exportSettings) {
        bridge.saveSettingsToFile({
          ...settings.getSettings(),
          exportSettings: exportSettings.getSettings(),
        });
      }
    });
  } else {
    logError('Save settings');
  }

  if (dom.buttons.save.exportSettings) {
    dom.buttons.save.exportSettings.addEventListener('click', (event) => {
      event.preventDefault();
      const { bridge, settings, exportSettings } = providers;
      if (bridge && settings && exportSettings) {
        bridge.saveSettingsToFile({
          ...settings.getSettings(),
          exportSettings: exportSettings.getSettings(),
        });
      }
    });
  } else {
    logError('Save export settings');
  }

  if (dom.buttons.resetExportSettings) {
    dom.buttons.resetExportSettings.addEventListener('click', (event) => {
      event.preventDefault();
      const { bridge, settings, exportSettings } = providers;
      if (exportSettings) {
        const defaults = exportSettings.getDefaultSettings();
        exportSettings.setSettings(defaults);
        if (bridge && settings) {
          bridge.saveSettingsToFile({
            ...settings.getSettings(),
            exportSettings: defaults,
          });
        } else {
          exportSettings.updateSettingsInLocalStorage();
        }
      }
    });
  } else {
    logError('Reset export settings');
  }
}
