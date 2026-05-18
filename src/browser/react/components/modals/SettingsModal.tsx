import * as React from 'react';

import {
  getAvailableLocales,
  normalizeLanguage,
  type LocaleInfo,
} from '../../../i18n';
import { useManagers } from '../../contexts/ManagersContext';
import { useModals } from '../../contexts/ModalsContext';
import { confirmExternal } from '../../contexts/PromptsContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Icon } from '../Icon';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Switch } from '../ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { AssistantSettings } from '../assistant/AssistantSettings';

/**
 * Editor settings dialog. Drives SettingsContext directly — every input
 * change calls `updateSetting(key, value)` which writes state, applies
 * the Monaco/theme side effect, emits to subscribers, and persists.
 * The explicit "Save Settings" button preserves the legacy UX (desktop
 * pushes the combined settings+exportSettings payload to the main
 * process); under web mode the per-change persist already handled it.
 */
type SettingsTab = 'general' | 'assistant';

export const SettingsModal: React.FC = () => {
  const { mode, bridgeManager, providers } = useManagers();
  const { open, payload, closeModal } = useModals();
  const { settings, updateSetting } = useSettings();
  const { t } = useTranslation();

  // Controlled tabs so the title + intro can switch with the active
  // tab. Initial value picks up `payload.tab` when the AssistantSidebar
  // empty-state CTA opens us straight on the AI Providers tab.
  const [activeTab, setActiveTab] = React.useState<SettingsTab>('general');
  React.useEffect(() => {
    if (open === 'settings') {
      const requested = payload && 'tab' in payload ? payload.tab : undefined;
      setActiveTab(requested === 'assistant' ? 'assistant' : 'general');
    }
  }, [open, payload]);

  const [locales, setLocales] = React.useState<LocaleInfo[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    getAvailableLocales()
      .then((list) => {
        if (cancelled) return;
        list.sort(
          (a, b) =>
            a.native.localeCompare(b.native) || a.code.localeCompare(b.code),
        );
        setLocales(list);
      })
      .catch(() => {
        // no-op; the select will just be empty
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleClearSession = async () => {
    if (!bridgeManager) return;
    const ok = await confirmExternal({
      title: t('modals-settings:clear_session_confirm_title'),
      description: t('modals-settings:clear_session_confirm_text'),
      confirmLabel: t('modals-settings:clear_session_confirm_button'),
      cancelLabel: t('modals-settings:clear_session_cancel_button'),
      destructive: true,
    });
    if (ok) {
      bridgeManager.bridge.send('to:session:clear', null);
    }
  };

  const handleSave = () => {
    if (
      mode === 'desktop' &&
      bridgeManager &&
      providers.settings &&
      providers.exportSettings
    ) {
      bridgeManager.saveSettingsToFile({
        ...providers.settings.getSettings(),
        exportSettings: providers.exportSettings.getSettings(),
      });
    }
    closeModal();
  };

  return (
    <Dialog open={open === 'settings'} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-[820px]"
      >
        <DialogHeader>
          <DialogTitle>
            {activeTab === 'assistant'
              ? t('modals-settings:title_assistant')
              : t('modals-settings:title')}
          </DialogTitle>
        </DialogHeader>
        <div className="px-4 pb-4 text-sm">
          <p className="text-muted-foreground">
            {activeTab === 'assistant'
              ? t('modals-settings:intro_assistant')
              : t('modals-settings:intro')}
          </p>
          {mode === 'desktop' && (
            <p className="mt-1 text-muted-foreground">
              <span>{t('modals-settings:settings_file_info')}</span>{' '}
              <span className="font-mono text-xs">
                ~/.mkeditor/settings.json
              </span>
              .
            </p>
          )}

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as SettingsTab)}
            className="mt-4"
          >
            <TabsList className="h-7 gap-0.5 p-0.5 text-xs">
              <TabsTrigger
                value="general"
                className="h-6 px-2 py-0.5 text-xs"
              >
                {t('modals-settings:tab_general')}
              </TabsTrigger>
              <TabsTrigger
                value="assistant"
                className="h-6 px-2 py-0.5 text-xs"
              >
                {t('modals-settings:tab_assistant')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="general">
              {/* Formatting + Miscellaneous share a 2-column row.
                  Sections drop their own separator (`separator={false}`)
                  because the parent already owns the top margin via
                  `mt-4`, and a divider in the middle of two side-by-
                  side groups would look strange. */}
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
                <Section
                  label={t('modals-settings:formatting')}
                  separator={false}
                >
                  <CheckboxRow
                    id="autoindent-setting"
                    label={t('modals-settings:autoindent_label')}
                    help={t('modals-settings:autoindent_help')}
                    checked={settings.autoindent}
                    onChange={(v) => updateSetting('autoindent', v)}
                  />
                  <CheckboxRow
                    id="wordwrap-setting"
                    label={t('modals-settings:wordwrap_label')}
                    help={t('modals-settings:wordwrap_help')}
                    checked={settings.wordwrap}
                    onChange={(v) => updateSetting('wordwrap', v)}
                  />
                </Section>

                <Section
                  label={t('modals-settings:miscellaneous')}
                  separator={false}
                >
                  <CheckboxRow
                    id="minimap-setting"
                    label={t('modals-settings:minimap_label')}
                    help={t('modals-settings:minimap_help')}
                    checked={settings.minimap}
                    onChange={(v) => updateSetting('minimap', v)}
                  />
                  <CheckboxRow
                    id="scrollsync-setting"
                    label={t('modals-settings:scrollsync_label')}
                    help={t('modals-settings:scrollsync_help')}
                    checked={settings.scrollsync}
                    onChange={(v) => updateSetting('scrollsync', v)}
                  />
                </Section>
              </div>

              <Section label={t('modals-settings:editing')}>
                <CheckboxRow
                  id="whitespace-setting"
                  label={t('modals-settings:whitespace_label')}
                  help={t('modals-settings:whitespace_help')}
                  checked={settings.whitespace}
                  onChange={(v) => updateSetting('whitespace', v)}
                />
              </Section>

              <Section label={t('modals-settings:session')}>
                <SwitchRow
                  id="session-restore-setting"
                  label={t('modals-settings:session_restore_label')}
                  help={t('modals-settings:session_restore_help')}
                  checked={settings.sessionRestore}
                  onChange={(v) => updateSetting('sessionRestore', v)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleClearSession}
                  className="self-start"
                >
                  <Icon name="trash" />
                  <span>{t('modals-settings:clear_session_button')}</span>
                </Button>
                <small className="text-muted-foreground">
                  {t('modals-settings:clear_session_help')}
                </small>
              </Section>

              <Section label={t('modals-settings:appearance')}>
                {mode === 'desktop' && (
                  <SwitchRow
                    id="systemtheme-setting"
                    label={t('modals-settings:systemtheme_label')}
                    help={t('modals-settings:systemtheme_help')}
                    checked={settings.systemtheme}
                    onChange={(v) => updateSetting('systemtheme', v)}
                  />
                )}
                <div className="mt-3">
                  <Label htmlFor="locale-setting">
                    {t('modals-settings:language_label')}
                  </Label>
                  <Select
                    value={normalizeLanguage(settings.locale || 'en')}
                    onValueChange={(v) => updateSetting('locale', v)}
                  >
                    <SelectTrigger id="locale-setting" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {locales.map((l) => (
                        <SelectItem key={l.code} value={l.code}>
                          {l.native} ({l.name})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('modals-settings:language_help')}
                  </p>
                </div>
              </Section>
            </TabsContent>

            <TabsContent value="assistant">
              <AssistantSettings />
            </TabsContent>
          </Tabs>

          <div className="mt-6 flex items-center gap-3">
            <Button type="button" size="sm" onClick={handleSave}>
              <Icon name="save" />
              <span>{t('modals-settings:save_settings')}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* -------------------------------------------------------------------- */
/*  Helpers                                                              */
/* -------------------------------------------------------------------- */

/**
 * One settings section: heading + child controls. Wraps in a single
 * div (NOT a Fragment) so the whole section behaves as one cell in a
 * `grid grid-cols-2` parent — otherwise the heading + children get
 * split across separate grid cells and you see the next section's
 * heading appearing below the previous section's checkboxes.
 *
 * `separator` (default true) draws the horizontal rule + top margin
 * that visually separates this section from whatever sits above it.
 * Set to false when the section sits inside a grid where the grid
 * itself owns the separator above it.
 */
const Section: React.FC<{
  label: string;
  separator?: boolean;
  children: React.ReactNode;
}> = ({ label, separator = true, children }) => (
  <div
    className={
      separator ? 'mt-4 border-t border-border pt-4' : undefined
    }
  >
    <p className="mb-2 font-semibold text-muted-foreground">{label}</p>
    <div className="flex flex-col gap-3">{children}</div>
  </div>
);

interface RowProps {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

const CheckboxRow: React.FC<RowProps> = ({
  id,
  label,
  help,
  checked,
  onChange,
}) => (
  <div className="flex items-start gap-2">
    <Checkbox
      id={id}
      checked={checked}
      onCheckedChange={(v) => onChange(v === true)}
      className="mt-0.5"
    />
    <Label htmlFor={id} className="flex flex-col gap-0.5">
      <span>{label}</span>
      <small className="text-muted-foreground">{help}</small>
    </Label>
  </div>
);

const SwitchRow: React.FC<RowProps> = ({
  id,
  label,
  help,
  checked,
  onChange,
}) => (
  <div className="flex items-start gap-3">
    <Switch
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      className="mt-0.5"
    />
    <Label htmlFor={id} className="flex flex-col gap-0.5">
      <span>{label}</span>
      <small className="text-muted-foreground">{help}</small>
    </Label>
  </div>
);
