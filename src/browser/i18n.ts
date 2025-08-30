import i18next from 'i18next';
import { refreshTooltips } from './dom';
import { logger } from './util';

const namespaces: { ns: string; path: string }[] = [
  { ns: 'app', path: 'locale/{{lng}}/app.json' },
  { ns: 'navbar', path: 'locale/{{lng}}/navbar.json' },
  { ns: 'sidebar', path: 'locale/{{lng}}/sidebar.json' },
  { ns: 'toolbar', path: 'locale/{{lng}}/toolbar.json' },
  { ns: 'menus-codeblocks', path: 'locale/{{lng}}/menus/codeblocks.json' },
  { ns: 'menus-alerts', path: 'locale/{{lng}}/menus/alerts.json' },
  { ns: 'menus-tables', path: 'locale/{{lng}}/menus/tables.json' },
  { ns: 'modals-settings', path: 'locale/{{lng}}/modals/settings.json' },
  { ns: 'modals-export', path: 'locale/{{lng}}/modals/export.json' },
  { ns: 'modals-about', path: 'locale/{{lng}}/modals/about.json' },
  { ns: 'modals-shortcuts', path: 'locale/{{lng}}/modals/shortcuts.json' },
];

function resolvePath(template: string, lng: string) {
  return template.replace('{{lng}}', lng);
}

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load: ${url}`);
  return (await res.json()) as Record<string, any>;
}

async function loadBundle(lng: string) {
  const bundle = resolvePath('locale/{{lng}}/all.json', lng);
  try {
    const data = await fetchJson(bundle);
    // { [namespace]: { ...translations } }
    for (const ns of Object.keys(data)) {
      const nsData = data[ns];
      if (nsData && typeof nsData === 'object') {
        i18next.addResourceBundle(lng, ns, nsData, true, true);
      }
    }
    return true;
  } catch (e) {
    // all.json not found, will fallback to individual bundles
    return false;
  }
}

async function fallbackLoadBundles(lng: string) {
  for (const { ns, path } of namespaces) {
    try {
      const data = await fetchJson(resolvePath(path, lng));
      i18next.addResourceBundle(lng, ns, data, true, true);
    } catch (e) {
      logger?.error(`i18n', 'Failed to load language bundles for ${lng}`);
    }
  }
}

export function normalizeLanguage(lng: string | null | undefined) {
  if (!lng) return 'en';
  // map BCP-47 to base language (en-GB -> en)
  const base = lng.toLowerCase().split(/[-_]/)[0];
  return base || 'en';
}

export async function initI18n(initialLng: string) {
  const lng = normalizeLanguage(initialLng);
  const ok = await loadBundle(lng);

  if (!ok) {
    await fallbackLoadBundles(lng);
  }

  await i18next.init({
    lng,
    fallbackLng: 'en',
    ns: namespaces.map((n) => n.ns),
    defaultNS: 'app',
    interpolation: { escapeValue: false },
    resources: {},
  });
}

export async function changeLanguage(lng: string) {
  const base = normalizeLanguage(lng);
  const ok = await loadBundle(base);

  if (!ok) {
    await fallbackLoadBundles(base);
  }

  await i18next.changeLanguage(base);
  applyTranslations();
  refreshTooltips();
}

export function t(key: string) {
  return i18next.t(key);
}

function setText(el: Element, key: string) {
  const val = t(key);
  el.textContent = val;
}

function setAttr(el: Element, attr: string, key: string) {
  const val = t(key);
  (el as HTMLElement).setAttribute(attr, val);
}

export function applyTranslations(root: ParentNode = document) {
  // Update document title
  if (typeof document !== 'undefined') {
    document.title = t('app:document_title');
    document.documentElement.setAttribute('lang', i18next.language);
  }

  // text content
  root.querySelectorAll('[data-i18n-text]')?.forEach((el) => {
    const key = (el as HTMLElement).dataset.i18nText;
    if (key) setText(el, key);
  });

  // title attribute
  root.querySelectorAll('[data-i18n-title]')?.forEach((el) => {
    const key = (el as HTMLElement).dataset.i18nTitle;
    if (key) {
      setAttr(el, 'title', key);
      setAttr(el, 'data-bs-original-title', key);
    }
  });

  // placeholder attribute
  root.querySelectorAll('[data-i18n-placeholder]')?.forEach((el) => {
    const key = (el as HTMLElement).dataset.i18nPlaceholder;
    if (key) setAttr(el, 'placeholder', key);
  });
}

export const I18n = { initI18n, changeLanguage, applyTranslations, t };

export type LocaleInfo = { code: string; name: string; native: string };

export async function getAvailableLocales(): Promise<LocaleInfo[]> {
  try {
    const res = await fetch('locale/manifest.json');
    if (!res.ok) throw new Error('manifest fetch failed');
    const data = (await res.json()) as LocaleInfo[];
    return data;
  } catch {
    // Fallback if manifest missing
    return [
      { code: 'en', name: 'English', native: 'English' },
      { code: 'de', name: 'German', native: 'Deutsch' },
      { code: 'es', name: 'Spanish', native: 'Español' },
      { code: 'fr', name: 'French', native: 'Français' },
      { code: 'it', name: 'Italian', native: 'Italiano' },
      { code: 'nl', name: 'Dutch', native: 'Nederlands' },
      { code: 'pt', name: 'Portuguese', native: 'Português' },
      { code: 'ru', name: 'Russian', native: 'Русский' },
      { code: 'uk', name: 'Ukrainian', native: 'Українська' },
      { code: 'tr', name: 'Turkish', native: 'Türkçe' },
      { code: 'zh', name: 'Chinese (Simplified)', native: '简体中文' },
      { code: 'ja', name: 'Japanese', native: '日本語' },
      { code: 'ko', name: 'Korean', native: '한국어' },
    ];
  }
}
