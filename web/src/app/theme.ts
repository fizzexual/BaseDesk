export type ThemePref = 'light' | 'dark' | 'system';

const THEME_KEY = 'basedesk-theme';

const media =
  typeof window !== 'undefined' && 'matchMedia' in window
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export function readThemePref(): ThemePref {
  if (typeof localStorage === 'undefined') return 'system';
  const raw = localStorage.getItem(THEME_KEY);
  return raw === 'dark' || raw === 'light' || raw === 'system' ? raw : 'system';
}

export function applyTheme(pref: ThemePref) {
  if (typeof document === 'undefined') return;
  const resolved = pref === 'system' ? (media?.matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = resolved;
  if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, pref);
}

export function initTheme() {
  media?.addEventListener('change', () => {
    if (readThemePref() === 'system') applyTheme('system');
  });
  applyTheme(readThemePref());
}
