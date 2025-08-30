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
  console.info('i18n bundle load fallback reached');
  for (const { ns, path } of namespaces) {
    try {
      const data = await fetchJson(resolvePath(path, lng));
      i18next.addResourceBundle(lng, ns, data, true, true);
    } catch (e) {
      logger?.error(`i18n', 'Failed to load fallback bundles for ${lng}`);
    }
  }
}

export function normalizeLanguage(lng: string | null | undefined) {
  if (!lng) return 'en';
  // map BCP-47 to base language (en-GB -> en)
  const base = lng.toLowerCase().split(/[-_]/)[0];
  return base || 'en';
}

export async function initI18n(initialLng: string, shouldLoadBundle: boolean) {
  const lng = normalizeLanguage(initialLng);

  if (shouldLoadBundle) {
    // TODO i18n init fails on first load
    // Workaround is to disable load here and immediately call
    // changeLanguage afterwards.
    const ok = await loadBundle(lng);
    if (!ok) {
      await fallbackLoadBundles(lng);
    }
  }

  await i18next.init({
    lng,
    fallbackLng: 'en',
    ns: namespaces.map((n) => n.ns),
    defaultNS: 'app',
    interpolation: { escapeValue: false },
  });

  return lng;
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

type NodeBinding =
  | { el: Element; kind: 'text'; key: string }
  | { el: Element; kind: 'title'; key: string }
  | { el: Element; kind: 'placeholder'; key: string };

let bindings: NodeBinding[] | null = null;

export function buildBindings(root: ParentNode = document) {
  const list: NodeBinding[] = [];

  // text content
  root.querySelectorAll('[data-i18n-text]')?.forEach((el) => {
    const key = (el as HTMLElement).dataset.i18nText as string;
    list.push({ el, kind: 'text', key });
  });

  // title attribute
  root.querySelectorAll('[data-i18n-title]')?.forEach((el) => {
    const key = (el as HTMLElement).dataset.i18nTitle as string;
    list.push({ el, kind: 'title', key });
  });

  // placeholder attribute
  root.querySelectorAll('[data-i18n-placeholder]')?.forEach((el) => {
    const key = (el as HTMLElement).dataset.i18nPlaceholder as string;
    list.push({ el, kind: 'placeholder', key });
  });

  return list;
}

// Call once after app mounts (and again for dynamically injected fragments)
export function prepareBindings(root: ParentNode = document) {
  const list = buildBindings(root);
  bindings = bindings ? bindings.concat(list) : list;
}

export function applyTranslations(root: ParentNode = document) {
  if (typeof document !== 'undefined') {
    const title = t('app:document_title');
    if (document.title !== title) document.title = title;

    const html = document.documentElement;
    if (html.getAttribute('lang') !== i18next.language) {
      html.setAttribute('lang', i18next.language);
    }

    const scope = root ? buildBindings(root) : (bindings ?? buildBindings());
    const cache = new Map<string, string>();

    requestAnimationFrame(() => {
      for (const b of scope) {
        const val = cache.get(b.key) ?? t(b.key);
        if (!cache.has(b.key)) cache.set(b.key, val);

        if (b.kind === 'text') {
          if (b.el.textContent !== val) b.el.textContent = val;
        } else if (b.kind === 'title') {
          const el = b.el as HTMLElement;
          if (el.getAttribute('title') !== val) el.setAttribute('title', val);
          if (
            el.getAttribute('data-bs-original-title') !== null &&
            el.getAttribute('data-bs-original-title') !== val
          ) {
            el.setAttribute('data-bs-original-title', val);
          }
        } else {
          const el = b.el as HTMLElement;
          if (el.getAttribute('placeholder') !== val)
            el.setAttribute('placeholder', val);
        }
      }
    });
  }
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
