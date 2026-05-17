import * as React from 'react';

import type { ExportSettings } from '../../../interfaces/Editor';
import { useManagers } from '../../contexts/ManagersContext';
import { useModals } from '../../contexts/ModalsContext';
import { useExportSettings } from '../../contexts/ExportSettingsContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Icon } from '../Icon';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

/**
 * HTML/PDF export settings dialog. ExportSettingsContext drives every
 * input change through `updateSetting(key, value)`, which already
 * (a) runs `syncPreviewToExportSettings` so the live preview reflects
 * the change immediately and (b) schedules a debounced persist
 * (250ms default, 400ms for the lineSpacing slider).
 */
export const ExportSettingsModal: React.FC = () => {
  const { mode, bridgeManager, providers } = useManagers();
  const { open, closeModal } = useModals();
  const { settings, updateSetting } = useExportSettings();
  const { t } = useTranslation();

  const handleSave = () => {
    if (mode === 'desktop' && bridgeManager && providers.settings) {
      bridgeManager.saveSettingsToFile({
        ...providers.settings.getSettings(),
        exportSettings: settings,
      });
    }
    closeModal();
  };

  const handleReset = () => {
    const defaults = providers.exportSettings?.getDefaultSettings();
    if (!defaults) return;
    (Object.keys(defaults) as (keyof ExportSettings)[]).forEach((key) => {
      updateSetting(key, defaults[key] as never);
    });
    if (mode === 'desktop' && bridgeManager && providers.settings) {
      bridgeManager.saveSettingsToFile({
        ...providers.settings.getSettings(),
        exportSettings: defaults,
      });
    }
  };

  return (
    <Dialog
      open={open === 'exportSettings'}
      onOpenChange={(o) => !o && closeModal()}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('modals-export:title')}</DialogTitle>
        </DialogHeader>
        <div className="px-4 pb-4 text-sm">
          <p className="text-muted-foreground">{t('modals-export:intro')}</p>
          {mode === 'desktop' && (
            <p className="mt-1 text-muted-foreground">
              {t('modals-export:settings_file_info')}
            </p>
          )}

          <hr className="my-4 border-border" />
          <div className="flex items-start gap-2">
            <Checkbox
              id="export-with-styles"
              checked={settings.withStyles}
              onCheckedChange={(v) => updateSetting('withStyles', v === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="export-with-styles"
              className="flex flex-col gap-0.5"
            >
              <span>{t('modals-export:export_with_styles_label')}</span>
              <small className="text-muted-foreground">
                {t('modals-export:export_with_styles_help')}
              </small>
            </Label>
          </div>

          <hr className="my-4 border-border" />
          <div className="flex flex-col gap-3">
            <Field
              id="export-setting-container"
              label={t('modals-export:set_container_label')}
              help={t('modals-export:set_container_help')}
            >
              <Select
                value={settings.container}
                onValueChange={(v) =>
                  updateSetting('container', v as ExportSettings['container'])
                }
              >
                <SelectTrigger id="export-setting-container">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="container">
                    {t('modals-export:set_container_option_container')}
                  </SelectItem>
                  <SelectItem value="container-fluid">
                    {t('modals-export:set_container_option_container_fluid')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field
              id="export-setting-fontsize"
              label={t('modals-export:set_font_size_label')}
              help={t('modals-export:set_font_size_help')}
            >
              <Input
                id="export-setting-fontsize"
                type="number"
                min={6}
                max={72}
                value={settings.fontSize}
                onChange={(e) =>
                  updateSetting(
                    'fontSize',
                    Math.max(6, parseInt(e.target.value, 10) || 16),
                  )
                }
              />
            </Field>

            <Field
              id="export-setting-linespacing"
              label={t('modals-export:set_line_spacing_label')}
              help={t('modals-export:set_line_spacing_help')}
            >
              {/* Native range — Radix has no slider primitive in our stack.
                  Styled via `accent-color` to pick up the brand teal. */}
              <input
                id="export-setting-linespacing"
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={settings.lineSpacing}
                onChange={(e) =>
                  updateSetting('lineSpacing', parseFloat(e.target.value))
                }
                className="h-2 w-full cursor-pointer accent-primary"
              />
            </Field>
          </div>

          <hr className="my-4 border-border" />
          <div className="flex flex-wrap items-start gap-6">
            <ColorField
              id="export-setting-background"
              label={t('modals-export:set_background_colour_label')}
              help={t('modals-export:set_background_colour_help')}
              value={settings.background}
              onChange={(v) => updateSetting('background', v)}
            />
            <ColorField
              id="export-setting-font-color"
              label={t('modals-export:set_font_colour_label')}
              help={t('modals-export:set_font_colour_help')}
              value={settings.fontColor}
              onChange={(v) => updateSetting('fontColor', v)}
            />
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button type="button" size="sm" onClick={handleSave}>
              <Icon name="save" />
              <span>{t('modals-export:save_settings')}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleReset}
            >
              <Icon name="refresh" />
              <span>{t('modals-export:reset_to_default')}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Field: React.FC<{
  id: string;
  label: string;
  help: string;
  children: React.ReactNode;
}> = ({ id, label, help, children }) => (
  <div>
    <Label htmlFor={id}>{label}</Label>
    <div className="mt-1">{children}</div>
    <p className="mt-1 text-xs text-muted-foreground">{help}</p>
  </div>
);

interface ColorFieldProps {
  id: string;
  label: string;
  help: string;
  value: string;
  onChange: (next: string) => void;
}

const ColorField: React.FC<ColorFieldProps> = ({
  id,
  label,
  help,
  value,
  onChange,
}) => (
  <div>
    <Label htmlFor={id}>{label}</Label>
    <div className="mt-1 flex items-center gap-2">
      <input
        id={id}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-10 cursor-pointer rounded border border-input bg-background p-0"
      />
      <span className="text-xs text-muted-foreground">
        {value.toUpperCase()}
      </span>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">{help}</p>
  </div>
);
