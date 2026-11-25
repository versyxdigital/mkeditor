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
import { Input } from '../ui/input';
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
import { CloudConnections } from '../cloud/CloudConnections';

/**
 * Editor settings dialog. Drives SettingsContext directly — every input
 * change calls `updateSetting(key, value)` which writes state, applies
 * the Monaco/theme side effect, emits to subscribers, and persists.
 * The explicit "Save Settings" button preserves the legacy UX (desktop
 * pushes the combined settings+exportSettings payload to the main
 * process); under web mode the per-change persist already handled it.
 */
type SettingsTab =
  | 'general'
  | 'assistant'
  | 'connections'
  | 'editor'
  | 'appearance'
  | 'preview'
  | 'workspace';

export const SettingsModal: React.FC = () => {
  const { mode, bridgeManager, providers } = useManagers();
  const { open, payload, closeModal, openModal } = useModals();
  const { settings, updateSetting } = useSettings();
  const { t } = useTranslation();

  // AI Assistant is desktop-only. On web we still render the
  // Settings modal (general settings remain) but the AI Providers
  // tab itself is hidden — and any externally-requested
  // `tab: 'assistant'` payload falls back to 'general'.
  const showAssistantTab = mode !== 'web';

  // Controlled tabs so the title + intro can switch with the active
  // tab. Initial value picks up `payload.tab` when the AssistantSidebar
  // empty-state CTA opens us straight on the AI Providers tab.
  const [activeTab, setActiveTab] = React.useState<SettingsTab>('general');
  React.useEffect(() => {
    if (open === 'settings') {
      const requested = payload && 'tab' in payload ? payload.tab : undefined;
      setActiveTab(
        requested === 'connections' ||
          (requested === 'assistant' && showAssistantTab)
          ? requested
          : 'general',
      );
    }
  }, [open, payload, showAssistantTab]);

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

  const sections: { id: SettingsTab; icon: string; label: string }[] = [
    { id: 'general', icon: 'cogs', label: t('modals-settings:tab_general') },
    ...(showAssistantTab
      ? [
          {
            id: 'assistant' as const,
            icon: 'comments',
            label: t('modals-settings:tab_assistant'),
          },
        ]
      : []),
    { id: 'connections', icon: 'link', label: t('cloud:connections') },
    { id: 'editor', icon: 'file', label: t('modals-settings:nav_editor') },
    { id: 'preview', icon: 'eye', label: t('modals-settings:nav_preview') },
    { id: 'appearance', icon: 'moon', label: t('modals-settings:appearance') },
    {
      id: 'workspace',
      icon: 'folder',
      label: t('modals-settings:nav_workspace'),
    },
  ];
  const configurationPath =
    activeTab === 'assistant'
      ? '~/.mkeditor/assistant.json'
      : activeTab === 'connections'
        ? '~/.mkeditor/connections.json'
        : '~/.mkeditor/settings.json';
  return (
    <Dialog
      open={open === 'settings'}
      onOpenChange={(value) => !value && closeModal()}
    >
      <DialogContent
        aria-describedby={undefined}
        className="thin-scrollbars flex h-[min(860px,calc(100dvh-32px))] max-w-[1200px] flex-col overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 border-b border-subtle px-5 py-4">
          <DialogTitle className="flex items-center gap-3">
            <Icon
              name={activeTab === 'assistant' ? 'comments' : 'cogs'}
              className="text-primary"
            />
            {activeTab === 'assistant'
              ? t('modals-settings:title_assistant')
              : activeTab === 'connections'
                ? t('cloud:connections')
                : t('modals-settings:title')}
          </DialogTitle>
        </DialogHeader>
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SettingsTab)}
          orientation="vertical"
          className="flex min-h-0 flex-1"
        >
          <div className="flex w-36 shrink-0 flex-col border-r border-subtle p-3 sm:w-48">
            <TabsList
              aria-label={t('modals-settings:title')}
              className="h-auto flex-col items-stretch justify-start gap-1 rounded-none bg-transparent p-0"
            >
              {sections.map((section) => (
                <TabsTrigger
                  key={section.id}
                  value={section.id}
                  className="min-h-9 justify-start gap-2 whitespace-normal px-3 py-2 text-left text-sm data-[state=active]:bg-accent-subtle data-[state=active]:text-primary"
                >
                  <Icon name={section.icon} />
                  <span>{section.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            <Button
              variant="ghost"
              className="mt-2 justify-start gap-2 whitespace-normal px-3 text-left text-sm text-muted-foreground"
              onClick={() => openModal('shortcuts')}
            >
              <Icon name="question-circle" />
              <span>{t('navbar:shortcuts_tooltip')}</span>
            </Button>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5 sm:p-6">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              {activeTab !== 'connections' && (
                <p className="max-w-xl text-sm text-muted-foreground">
                  {activeTab === 'assistant'
                    ? t('modals-settings:intro_assistant')
                    : t('modals-settings:intro')}
                </p>
              )}
              {mode === 'desktop' && (
                <div className="flex min-w-0 items-center gap-2 rounded-lg border border-subtle bg-sidebar px-3 py-2 text-xs text-muted-foreground">
                  <Icon name="folder" />
                  <span className="min-w-0 break-all font-mono">
                    {configurationPath}
                  </span>
                </div>
              )}
            </div>
            <TabsContent value="general" className="mt-0">
              <Section
                label={t('modals-settings:language_label')}
                separator={false}
              >
                <Label htmlFor="locale-setting">
                  {t('modals-settings:language_label')}
                </Label>
                <Select
                  value={normalizeLanguage(settings.locale || 'en')}
                  onValueChange={(value) => updateSetting('locale', value)}
                >
                  <SelectTrigger id="locale-setting">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locales.map((locale) => (
                      <SelectItem key={locale.code} value={locale.code}>
                        {locale.native} ({locale.name})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('modals-settings:language_help')}
                </p>
              </Section>
            </TabsContent>
            <TabsContent value="connections" className="mt-0">
              <CloudConnections />
            </TabsContent>
            <TabsContent value="editor" className="mt-0">
              <Section label={t('modals-settings:editing')} separator={false}>
                {(
                  ['autoindent', 'wordwrap', 'whitespace', 'minimap'] as const
                ).map((key) => (
                  <CheckboxRow
                    key={key}
                    id={key + '-setting'}
                    label={t('modals-settings:' + key + '_label')}
                    help={t('modals-settings:' + key + '_help')}
                    checked={settings[key]}
                    onChange={(value) => updateSetting(key, value)}
                  />
                ))}
              </Section>
            </TabsContent>
            <TabsContent value="preview" className="mt-0">
              <Section
                label={t('modals-settings:nav_preview')}
                separator={false}
              >
                <CheckboxRow
                  id="scrollsync-setting"
                  label={t('modals-settings:scrollsync_label')}
                  help={t('modals-settings:scrollsync_help')}
                  checked={settings.scrollsync}
                  onChange={(value) => updateSetting('scrollsync', value)}
                />
                <Button
                  variant="outline"
                  className="self-start"
                  onClick={() => openModal('exportSettings')}
                >
                  <Icon name="sliders" />
                  {t('toolbar:configure_export_settings')}
                </Button>
              </Section>
            </TabsContent>
            <TabsContent value="appearance" className="mt-0">
              <Section
                label={t('modals-settings:appearance')}
                separator={false}
              >
                {mode === 'desktop' && (
                  <SwitchRow
                    id="systemtheme-setting"
                    label={t('modals-settings:systemtheme_label')}
                    help={t('modals-settings:systemtheme_help')}
                    checked={settings.systemtheme}
                    onChange={(value) => updateSetting('systemtheme', value)}
                  />
                )}
                <SwitchRow
                  id="settings-darkmode"
                  label={t('modals-settings:darkmode_label')}
                  help={t('navbar:theme_switch_notice')}
                  checked={settings.effectiveDarkmode}
                  disabled={mode === 'desktop' && settings.systemtheme}
                  onChange={(value) => updateSetting('darkmode', value)}
                />
              </Section>
            </TabsContent>
            <TabsContent value="workspace" className="mt-0">
              <Section label={t('modals-settings:session')} separator={false}>
                <SwitchRow
                  id="session-restore-setting"
                  label={t('modals-settings:session_restore_label')}
                  help={t('modals-settings:session_restore_help')}
                  checked={settings.sessionRestore}
                  onChange={(value) => updateSetting('sessionRestore', value)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleClearSession}
                  className="self-start"
                >
                  <Icon name="trash" />
                  {t('modals-settings:clear_session_button')}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t('modals-settings:clear_session_help')}
                </p>
              </Section>
              <Section label={t('modals-settings:paste_images')}>
                <Label htmlFor="paste-images-directory-setting">
                  {t('modals-settings:paste_images_directory_label')}
                </Label>
                <Input
                  id="paste-images-directory-setting"
                  value={settings.pasteImages?.directory ?? './assets'}
                  onChange={(event) =>
                    updateSetting('pasteImages', {
                      directory: event.target.value,
                    })
                  }
                  placeholder="./assets"
                  className="font-mono text-xs"
                  data-testid="paste-images-directory-input"
                />
                <p className="text-xs text-muted-foreground">
                  {t('modals-settings:paste_images_directory_help')}
                </p>
              </Section>
            </TabsContent>
            {showAssistantTab && (
              <TabsContent value="assistant" className="mt-0">
                <AssistantSettings />
              </TabsContent>
            )}
          </div>
        </Tabs>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-subtle px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {t('modals-settings:changes_apply_immediately')}
          </p>
          <Button type="button" size="sm" onClick={handleSave}>
            <Icon name="save" />
            {t('modals-settings:save_settings')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* -------------------------------------------------------------------- */
/*  Helpers                                                              */
/* -------------------------------------------------------------------- */

/**
 * Groups related controls under a heading, optionally separated from
 * the previous section by a rule.
 */
const Section: React.FC<{
  label: string;
  separator?: boolean;
  children: React.ReactNode;
}> = ({ label, separator = true, children }) => (
  <div className={separator ? 'mt-4 border-t border-border pt-4' : undefined}>
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
  disabled?: boolean;
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
  disabled,
}) => (
  <div className="flex items-start gap-3">
    <Switch
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className="mt-0.5"
    />
    <Label htmlFor={id} className="flex flex-col gap-0.5">
      <span>{label}</span>
      <small className="text-muted-foreground">{help}</small>
    </Label>
  </div>
);
