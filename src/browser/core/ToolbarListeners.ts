import type { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import type { EditorProviders } from '../interfaces/Providers';
import { HTMLExporter } from './HTMLExporter';
import { exportSettings } from '../config';
import { logger } from '../util';
import { dom } from '../dom';

/**
 * Register listeners for cross-context events.
 */
export function registerUIToolbarListeners(
  mkeditor: editor.IStandaloneCodeEditor | null,
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

  if (dom.buttons.save.markdown) {
    dom.buttons.save.markdown.addEventListener('click', (event) => {
      event.preventDefault();
      if (mkeditor) {
        if (providers.bridge) {
          providers.bridge.saveContentToFile();
        } else {
          HTMLExporter.webExport(mkeditor.getValue(), 'text/plain', '.md');
        }
      }
    });
  } else {
    logError('Save markdown');
  }

  /**
   * Get the rendered HTML for export.
   * @returns - the rendered HTML
   */
  const generateHTMLForExport = () => {
    const settings = providers.exportSettings?.getSettings() ?? exportSettings;

    return HTMLExporter.generateHTML(dom.preview.dom.outerHTML, settings);
  };

  // Register the event listener for the editor UI export HTML button.
  if (dom.buttons.save.html) {
    dom.buttons.save.html.addEventListener('click', (event) => {
      event.preventDefault();
      const html = generateHTMLForExport();

      if (providers.bridge) {
        providers.bridge.exportToDifferentFormat({
          content: html,
          type: 'html',
        });
      } else {
        HTMLExporter.webExport(html, 'text/html', '.html');
      }
    });
  } else {
    logError('Export to HTML');
  }

  // Register the event listener for the editor UI export PDF button.
  if (dom.buttons.save.pdf) {
    dom.buttons.save.pdf.addEventListener('click', (event) => {
      event.preventDefault();
      const html = generateHTMLForExport();

      if (providers.bridge) {
        providers.bridge.exportToDifferentFormat({
          content: html,
          type: 'pdf',
        });
      } else {
        HTMLExporter.webExport(html, 'text/html', '.pdf');
      }
    });
  } else {
    logError('Export to PDF');
  }
}
