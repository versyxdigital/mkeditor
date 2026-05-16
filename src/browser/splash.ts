/**
 * Splash overlay fade. Phase 9 moved this out of dom.ts so dom.ts can
 * be trimmed to just the constants still consumed by non-React code
 * (`#editor` fallback, preview content/wrapper getters, scroll-sync
 * meta attributes).
 */
export function showSplashScreen({ duration }: { duration: number }) {
  const splash = document.getElementById('splashscreen');
  const reactRoot = document.getElementById('react-root');
  if (!splash || !reactRoot) return;

  fade(splash, 'out', duration, () => {
    fade(reactRoot, 'in', duration);
    // Reveal the bottom fixed `<nav>` shell together with the editor.
    // It's a sibling of `#splashscreen` in views/index.html, so without
    // this it would be visible *through* the fading splash.
    document
      .querySelectorAll<HTMLElement>('body > nav')
      .forEach((nav) => fade(nav, 'in', duration));
  });
}

export function fade(
  element: HTMLElement,
  direction: 'in' | 'out',
  duration: number,
  callback?: () => void,
) {
  if (direction === 'in') {
    fadeIn(element, duration, callback);
  } else {
    fadeOut(element, duration, callback);
  }
}

function fadeOut(
  element: HTMLElement,
  duration: number,
  callback?: () => void,
) {
  let alpha = 1;
  const interval = 16; // ~60 FPS
  const decrement = interval / duration;

  const timer = setInterval(() => {
    alpha -= decrement;
    if (alpha <= 0) {
      clearInterval(timer);
      element.style.display = 'none';
      element.style.opacity = '0';
      if (callback) callback();
    } else {
      element.style.opacity = alpha.toString();
    }
  }, interval);
}

function fadeIn(element: HTMLElement, duration: number, callback?: () => void) {
  let alpha = 0;
  element.style.display = '';
  const interval = 16; // ~60 FPS
  const increment = interval / duration;

  const timer = setInterval(() => {
    alpha += increment;
    if (alpha >= 1) {
      clearInterval(timer);
      element.style.opacity = '1';
      if (callback) callback();
    } else {
      element.style.opacity = alpha.toString();
    }
  }, interval);
}
