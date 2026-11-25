jest.mock('../src/browser/util', () => ({
  logger: { error: jest.fn(), warn: jest.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const response = (value: object) =>
  ({ ok: true, json: async () => value }) as Response;

beforeEach(() => {
  jest.resetModules();
  localStorage.clear();
  jest.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('locale preference recovery', () => {
  it('preserves English fallback, intentional empty strings and interpolation across language changes', async () => {
    const i18n = await import('../src/browser/i18n');
    const { default: engine } = await import('i18next');
    await i18n.prepareI18n('de-DE', false);
    engine.addResourceBundle('en', 'app', {
      englishOnly: 'English fallback',
      emptyLabel: 'English label',
      greeting: 'Hello {{name}}',
      files_one: '{{count}} file',
      files_other: '{{count}} files',
    });
    engine.addResourceBundle('de', 'app', {
      emptyLabel: '',
      greeting: 'Hallo {{name}}',
    });
    expect(engine.language).toBe('de');
    expect(i18n.t('app:englishOnly')).toBe('English fallback');
    expect(i18n.t('app:emptyLabel')).toBe('');
    expect(i18n.t('app:greeting', { name: 'Chris' })).toBe('Hallo Chris');
    expect(i18n.t('app:files', { count: 1 })).toBe('1 file');
    expect(i18n.t('app:files', { count: 2 })).toBe('2 files');
    engine.addResourceBundle('fr', 'app', { greeting: 'Bonjour {{name}}' });
    await engine.changeLanguage('fr');
    expect(i18n.t('app:greeting', { name: 'Chris' })).toBe('Bonjour Chris');
  });
  it.each(['{', 'null', '[]', '{"locale":42}', '{"locale":{}}'])(
    'uses the browser language for malformed preferences %s',
    async (stored) => {
      localStorage.setItem('mkeditor-settings', stored);
      const { getUserLocale } = await import('../src/browser/i18n');
      expect(getUserLocale('web')).toBe('de-DE');
    },
  );

  it('starts with browser preferences when storage access is blocked', async () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const { getUserLocale } = await import('../src/browser/i18n');
    expect(getUserLocale('web')).toBe('de-DE');
  });

  it('ignores failed speculative prefetches so fallback can retry', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    const { prefetchLanguage } = await import('../src/browser/i18n');
    prefetchLanguage('fr');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('concurrent language loading', () => {
  it('keeps the latest selected language when an older download finishes last', async () => {
    const french = deferred<Response>();
    global.fetch = jest.fn((url: string) =>
      url.includes('/fr/')
        ? french.promise
        : Promise.resolve(response({ app: { document_title: 'Deutsch' } })),
    ) as jest.Mock;
    const i18n = await import('../src/browser/i18n');
    await i18n.prepareI18n('en', false);
    const older = i18n.changeLanguage('fr');
    await i18n.changeLanguage('de');
    expect(document.documentElement.lang).toBe('de');
    french.resolve(response({ app: { document_title: 'Français' } }));
    await older;
    expect(document.documentElement.lang).toBe('de');
    expect(document.title).toBe('Deutsch');
  });

  it('does not clear readiness while a newer language request is still pending', async () => {
    const french = deferred<Response>();
    const german = deferred<Response>();
    global.fetch = jest.fn((url: string) =>
      url.includes('/fr/') ? french.promise : german.promise,
    ) as jest.Mock;
    const i18n = await import('../src/browser/i18n');
    await i18n.prepareI18n('en', false);
    const older = i18n.changeLanguage('fr');
    const newer = i18n.changeLanguage('de');
    french.resolve(response({ app: { document_title: 'Français' } }));
    await older;
    let ready = false;
    const pending = i18n.whenLanguageReady().then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    german.resolve(response({ app: { document_title: 'Deutsch' } }));
    await newer;
    await pending;
    expect(ready).toBe(true);
  });

  it('retries a language after a partially failed namespace fallback', async () => {
    let combinedRequests = 0;
    global.fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/all.json')) {
        combinedRequests += 1;
        return combinedRequests === 1
          ? ({ ok: false } as Response)
          : response({ app: { document_title: 'Recovered' } });
      }
      return url.endsWith('/app.json')
        ? ({ ok: false } as Response)
        : response({});
    }) as jest.Mock;
    const i18n = await import('../src/browser/i18n');
    await i18n.prepareI18n('en', false);
    await i18n.changeLanguage('fr');
    await i18n.changeLanguage('fr');
    expect(combinedRequests).toBe(2);
    expect(document.title).toBe('Recovered');
  });
});
