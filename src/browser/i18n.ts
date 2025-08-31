import i18next from 'i18next';
import { refreshTooltips } from './dom';
import { logger } from './util';

export type LocaleInfo = { code: string; name: string; native: string };

/**
 * Bindings for the DOM elements to translate.
 */
type NodeBinding =
  | { el: Element; kind: 'text'; key: string }
  | { el: Element; kind: 'title'; key: string }
  | { el: Element; kind: 'placeholder'; key: string };

let bindings: NodeBinding[] | null = null;

/**
 * i18n files.
 * These files are combind at build-time into a singular all.json file
 * for each language. The individual files are used as a fallback in case
 * the combined bundle failed to build.
 */
const namespaces: { ns: string; path: string }[] = [
  { ns: 'app', path: 'locale/{{lng}}/app.json' },
  { ns: 'navbar', path: 'locale/{{lng}}/navbar.json' },
  { ns: 'sidebar', path: 'locale/{{lng}}/sidebar.json' },
  { ns: 'toolbar', path: 'locale/{{lng}}/toolbar.json' },
  { ns: 'menus-explorer', path: 'locale/{{lng}}/menus/explorer.json' },
  { ns: 'notifications', path: 'locale/{{lng}}/notifications.json' },
  { ns: 'modals-unsaved', path: 'locale/{{lng}}/modals/unsaved.json' },
  { ns: 'modals-properties', path: 'locale/{{lng}}/modals/properties.json' },
  { ns: 'menus-codeblocks', path: 'locale/{{lng}}/menus/codeblocks.json' },
  { ns: 'menus-alerts', path: 'locale/{{lng}}/menus/alerts.json' },
  { ns: 'menus-tables', path: 'locale/{{lng}}/menus/tables.json' },
  { ns: 'modals-settings', path: 'locale/{{lng}}/modals/settings.json' },
  { ns: 'modals-export', path: 'locale/{{lng}}/modals/export.json' },
  { ns: 'modals-about', path: 'locale/{{lng}}/modals/about.json' },
  { ns: 'modals-shortcuts', path: 'locale/{{lng}}/modals/shortcuts.json' },
];

// Cache fetched JSON resources by URL (dedupe concurrent/duplicate requests)
const resourceCache = new Map<string, Promise<Record<string, any>>>();

// Track languages already loaded into i18next to avoid re-adding bundles
const loadedLanguages = new Set<string>();

/**
 * Resolve a path for the given language.
 *
 * @param template - the path
 * @param lng - the language to replace
 * @returns
 */
function resolvePath(template: string, lng: string) {
  return template.replace('{{lng}}', lng);
}

/**
 * Fetch the JSON from the given i18n file.
 *
 * @param url - the path to the JSON file
 * @returns
 */
async function fetchJson(url: string) {
  if (resourceCache.has(url)) return resourceCache.get(url)!;

  const p = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load: ${url}`);
    return (await res.json()) as Record<string, any>;
  })().catch((err) => {
    // On failure, clear the cache entry so subsequent attempts can retry
    resourceCache.delete(url);
    throw err;
  });

  resourceCache.set(url, p);
  return p;
}

/**
 * Get the available locales for the user to choose from.
 *
 * @returns
 */
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

/**
 * Get the app locale.
 *
 * @returns - the app locale
 */
export function getUserLocale(mode: 'desktop' | 'web') {
  let userLocale = 'en';

  if (mode === 'desktop') {
    if (Object.prototype.hasOwnProperty.call(window, 'mked') && window.mked) {
      userLocale = window.mked.getAppLocale();
    }
  } else {
    const settings = JSON.parse(
      <string>localStorage.getItem('mkeditor-settings'),
    );

    if (settings && settings.locale) {
      userLocale = settings.locale;
    } else {
      userLocale = navigator.language;
    }
  }

  return userLocale;
}

/**
 * Build the i18n DOM bindings.
 *
 * @param root - the document root
 * @returns
 */
export function buildBindings(root: ParentNode = document) {
  const list: NodeBinding[] = [];

  // Single-pass scan for all supported data-i18n-* attributes
  const nodes = root.querySelectorAll(
    '[data-i18n-text],[data-i18n-title],[data-i18n-placeholder]',
  );

  nodes.forEach((el) => {
    const htmlEl = el as HTMLElement;
    if (htmlEl.dataset.i18nText) {
      list.push({ el, kind: 'text', key: htmlEl.dataset.i18nText });
    }

    if (htmlEl.dataset.i18nTitle) {
      list.push({ el, kind: 'title', key: htmlEl.dataset.i18nTitle });
    }

    if (htmlEl.dataset.i18nPlaceholder) {
      list.push({
        el,
        kind: 'placeholder',
        key: htmlEl.dataset.i18nPlaceholder,
      });
    }
  });

  return list;
}

/**
 * Prepare the bindings for i18n injection.
 *
 * @param root - the document root
 */
export function prepareBindings(root: ParentNode = document) {
  const list = buildBindings(root);
  bindings = bindings ? bindings.concat(list) : list;
}

/**
 * Load the combined i18n bundle.
 *
 * @param lng - the language to load
 * @returns
 */
async function loadCombinedBundle(lng: string) {
  const bundle = resolvePath('locale/{{lng}}/all.json', lng);
  try {
    if (loadedLanguages.has(lng)) return true;
    const data = await fetchJson(bundle);
    // { [namespace]: { ...translations } }
    for (const ns of Object.keys(data)) {
      const nsData = data[ns];
      if (nsData && typeof nsData === 'object') {
        i18next.addResourceBundle(lng, ns, nsData, true, true);
      }
    }
    loadedLanguages.add(lng);
    return true;
  } catch (e) {
    // all.json not found, will fallback to individual bundles
    return false;
  }
}

/**
 * Fallback to load the individual i18n bundles in case the
 * combined bundle failed to generate.
 *
 * @param lng - the language to load
 */
async function loadFallbackBundles(lng: string) {
  console.info('i18n bundle load fallback reached');
  const results = await Promise.allSettled(
    namespaces.map(({ path }) => fetchJson(resolvePath(path, lng))),
  );

  results.forEach((res, idx) => {
    const { ns } = namespaces[idx];
    if (res.status === 'fulfilled') {
      try {
        i18next.addResourceBundle(lng, ns, res.value, true, true);
      } catch {
        logger?.error(`i18n: Failed to add fallback bundle ${ns} for ${lng}`);
      }
    } else {
      logger?.error(`i18n: Failed to load fallback bundle '${ns}' for ${lng}`);
    }
  });

  loadedLanguages.add(lng);
}

/**
 * Normalize the language, map BCP-47 to base language.
 * E.g. en-GB -> en
 *
 * @param lng - the language to load
 * @returns
 */
export function normalizeLanguage(lng: string | null | undefined) {
  if (!lng) return 'en';
  const base = lng.toLowerCase().split(/[-_]/)[0];
  return base || 'en';
}

/**
 * Warm the cache for a language's combined bundle.
 * Does not mutate i18next; safe to call before init.
 *
 * @param lng - the language to preload
 * @returns
 */
export function prefetchLanguage(lng: string) {
  const base = normalizeLanguage(lng);
  const bundle = resolvePath('locale/{{lng}}/all.json', base);
  void fetchJson(bundle);
}

/**
 * Initialize i18n with the user's locale.
 *
 * @param mode - determines where to check for overridden locale.
 */
export function initI18n(mode: 'web' | 'desktop') {
  const locale = getUserLocale(mode);

  // Precompute all i18n bindings and warm language bundle fetch ASAP
  prepareBindings(document);
  prefetchLanguage(locale);

  // Set initial html lang attribute early for a11y and consistency
  document.documentElement.setAttribute('lang', normalizeLanguage(locale));

  // Init i18n and then apply language (resources already warming)
  prepareI18n(locale, false).then((lng) => {
    changeLanguage(lng);
    console.log(`initialized i18n for locale: ${lng}`);
  });
}

/**
 * Initialize i18n.
 *
 * @param initialLng - the language to load
 * @param shouldLoadBundle - see comment within
 * @returns
 */
export async function prepareI18n(
  initialLng: string,
  shouldLoadBundle: boolean,
) {
  const lng = normalizeLanguage(initialLng);

  if (shouldLoadBundle) {
    // TODO i18n init fails on first load
    // Workaround is to disable load here and immediately call
    // changeLanguage afterwards.
    const ok = await loadCombinedBundle(lng);
    if (!ok) {
      await loadFallbackBundles(lng);
    }
  }

  await i18next.init({
    lng,
    fallbackLng: 'en',
    ns: namespaces.map((n) => n.ns),
    defaultNS: 'app',
    interpolation: { escapeValue: false },
    initAsync: false,
  });

  return lng;
}

/**
 * Change the language.
 *
 * @param lng - the language to load
 */
export async function changeLanguage(lng: string) {
  const base = normalizeLanguage(lng);
  const ok = await loadCombinedBundle(base);
  if (!ok) {
    await loadFallbackBundles(base);
  }

  await i18next.changeLanguage(base);
  applyTranslations();
  refreshTooltips();
}

/**
 * Get the translation for the given key
 * @param key - e.g. app:title
 * @returns
 */
export function t<T extends string>(
  key: string,
  values?: Record<string, unknown>,
) {
  return i18next.t(key, values as any) as T;
}

/**
 * Apply translations to the DOM.
 *
 * @param root - the document root.
 */
export function applyTranslations(root: ParentNode = document) {
  if (typeof document !== 'undefined') {
    const title = t('app:document_title');
    if (document.title !== title) document.title = title;

    const html = document.documentElement;
    if (html.getAttribute('lang') !== i18next.language) {
      html.setAttribute('lang', i18next.language);
    }

    // Reuse pre-built bindings if available; otherwise build once and cache
    const scope = root
      ? buildBindings(root)
      : bindings
        ? bindings
        : (bindings = buildBindings());

    const cache = new Map<string, string>();

    for (const bdg of scope) {
      const val = cache.get(bdg.key) ?? t(bdg.key);
      if (!cache.has(bdg.key)) cache.set(bdg.key, val);

      if (bdg.kind === 'text') {
        if (bdg.el.textContent !== val) bdg.el.textContent = val;
      } else if (bdg.kind === 'title') {
        const el = bdg.el as HTMLElement;
        if (el.getAttribute('title') !== val) el.setAttribute('title', val);
        if (
          el.getAttribute('data-bs-original-title') !== null &&
          el.getAttribute('data-bs-original-title') !== val
        ) {
          el.setAttribute('data-bs-original-title', val);
        }
      } else {
        const el = bdg.el as HTMLElement;
        if (el.getAttribute('placeholder') !== val)
          el.setAttribute('placeholder', val);
      }
    }
  }
}
