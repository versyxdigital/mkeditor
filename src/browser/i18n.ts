import i18next from 'i18next';

type Mode = 'web' | 'desktop';

const NAMESPACES: { ns: string; path: string }[] = [
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

async function loadBundles(lng: string) {
  for (const { ns, path } of NAMESPACES) {
    try {
      const data = await fetchJson(resolvePath(path, lng));
      i18next.addResourceBundle(lng, ns, data, true, true);
    } catch (e) {
      // ignore missing namespaces for a language; fallback will handle
      // console.warn('i18n: missing namespace', ns, 'for', lng, e);
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
  console.log('lng: ' + lng);
  await loadBundles(lng);

  await i18next.init({
    lng,
    fallbackLng: 'en',
    ns: NAMESPACES.map((n) => n.ns),
    defaultNS: 'app',
    interpolation: { escapeValue: false },
    resources: {},
  });
}

export async function changeLanguage(lng: string) {
  const base = normalizeLanguage(lng);
  if (!i18next.hasResourceBundle(base, 'app')) {
    await loadBundles(base);
  }
  await i18next.changeLanguage(base);
  applyTranslations();
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
    if (key) setAttr(el, 'title', key);
  });

  // placeholder attribute
  root.querySelectorAll('[data-i18n-placeholder]')?.forEach((el) => {
    const key = (el as HTMLElement).dataset.i18nPlaceholder;
    if (key) setAttr(el, 'placeholder', key);
  });
}

export const I18n = { initI18n, changeLanguage, applyTranslations, t };
