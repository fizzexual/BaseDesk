import { useEffect, useState } from 'react';
import { applyTheme, readThemePref, type ThemePref } from '../app/theme';
import { IconMoon, IconSun } from '../icons';

// Cycle order for the header toggle and the human label for each state.
const ORDER: ThemePref[] = ['light', 'dark', 'system'];
const LABEL: Record<ThemePref, string> = { light: 'Light', dark: 'Dark', system: 'System' };

// No monitor/system glyph ships in ../icons, so this portal-local icon fills the
// gap. It matches the shared icon conventions (20x20, currentColor, 1.5 stroke).
function IconMonitor({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
      <path d="M7 16.5h6" />
      <path d="M10 13.5v3" />
    </svg>
  );
}

const ICON: Record<ThemePref, (p: { size?: number; className?: string }) => React.ReactNode> = {
  light: IconSun,
  dark: IconMoon,
  system: IconMonitor,
};

/** Compact header control that cycles light -> dark -> system, reusing the app's
 * theme helpers so the portal shares one stored preference with the agent app. */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(() => readThemePref());

  // initTheme() applies the stored preference at boot; re-applying on mount keeps
  // local state and the document in agreement even if the portal loads in isolation.
  useEffect(() => {
    applyTheme(pref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length]!;
    setPref(next);
    applyTheme(next);
  }

  const Icon = ICON[pref];
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${LABEL[pref]}. Change theme.`}
      title={`Theme: ${LABEL[pref]}`}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
    >
      <Icon size={16} />
    </button>
  );
}
