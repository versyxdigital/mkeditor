import * as React from 'react';
import { act, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { useTranslation } from '../../src/browser/react/hooks/useTranslation';

jest.mock('../../src/browser/i18n', () => ({
  t: (key: string) => i18next.t(key),
}));

function Probe({ id = 'translation' }: { id?: string }) {
  const { t, language } = useTranslation();
  return (
    <span data-testid={id} data-language={language}>
      {t('probe:title')}
    </span>
  );
}

beforeEach(async () => {
  await i18next.init({
    lng: 'en',
    fallbackLng: false,
    resources: {},
    initAsync: false,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useTranslation subscriptions', () => {
  it('updates when resources arrive for the current language without a language change', () => {
    render(<Probe />);
    expect(screen.getByTestId('translation')).toHaveTextContent('title');
    act(() => {
      i18next.addResourceBundle('en', 'probe', { title: 'Loaded' });
    });
    expect(screen.getByTestId('translation')).toHaveTextContent('Loaded');
  });

  it('updates when a resource is removed from the current language', () => {
    i18next.addResourceBundle('en', 'probe', { title: 'Loaded' });
    render(<Probe />);
    act(() => {
      i18next.removeResourceBundle('en', 'probe');
    });
    expect(screen.getByTestId('translation')).toHaveTextContent('title');
  });

  it('shares emitter subscriptions across consumers and tears them down after the last unmount', () => {
    const on = jest.spyOn(i18next, 'on');
    const off = jest.spyOn(i18next, 'off');
    const storeOn = jest.spyOn(i18next.store, 'on');
    const storeOff = jest.spyOn(i18next.store, 'off');
    const { unmount } = render(
      <>
        <Probe id="one" />
        <Probe id="two" />
      </>,
    );
    expect(
      on.mock.calls.filter(([event]) => event === 'languageChanged'),
    ).toHaveLength(1);
    expect(
      storeOn.mock.calls.filter(([event]) => event === 'added'),
    ).toHaveLength(1);
    const prior = Number(
      screen.getByTestId('one').getAttribute('data-language')!.split('|')[0],
    );
    act(() => {
      i18next.addResourceBundle('en', 'probe', { title: 'Shared' });
    });
    expect(screen.getByTestId('one')).toHaveTextContent('Shared');
    expect(screen.getByTestId('two')).toHaveTextContent('Shared');
    expect(
      Number(
        screen.getByTestId('one').getAttribute('data-language')!.split('|')[0],
      ),
    ).toBe(prior + 1);
    unmount();
    expect(
      off.mock.calls.filter(([event]) => event === 'languageChanged'),
    ).toHaveLength(1);
    expect(
      storeOff.mock.calls.filter(([event]) => event === 'added'),
    ).toHaveLength(1);
  });

  it('reattaches to the new resource store after i18next reinitializes', async () => {
    render(<Probe />);
    await act(async () => {
      await i18next.init({
        lng: 'en',
        fallbackLng: false,
        resources: {},
        initAsync: false,
      });
    });
    act(() => {
      i18next.addResourceBundle('en', 'probe', { title: 'New store' });
    });
    expect(screen.getByTestId('translation')).toHaveTextContent('New store');
  });
});
