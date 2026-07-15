const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Black or white text for a hex background, by perceived luminance. */
export function contrastFg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#141816' : '#ffffff';
}

/**
 * Apply (or clear) a white-label accent by overriding the CSS token inline on
 * :root — an inline value wins over the theme rules, so the brand color holds in
 * both light and dark. An empty/invalid color restores the built-in accent.
 */
export function applyAccent(color: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (HEX_RE.test(color)) {
    root.style.setProperty('--accent', color);
    root.style.setProperty('--accent-fg', contrastFg(color));
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-fg');
  }
}
