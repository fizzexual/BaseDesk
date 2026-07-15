import { useState } from 'react';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Button } from '../../components/Button';
import { toast } from '../../components/Toast';
import { useApp } from '../../data/store';
import { IconMoon, IconSun } from '../../icons';

const SWATCHES = [
  { label: 'bg', className: 'bg-bg' },
  { label: 'surface', className: 'bg-surface' },
  { label: 'surface-2', className: 'bg-surface-2' },
  { label: 'accent', className: 'bg-accent' },
  { label: 'green', className: 'bg-green' },
];

export function Appearance() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);

  return (
    <section>
      <h2 className="text-[15px] font-semibold">Appearance</h2>
      <div className="mt-4 text-[13px] font-medium">Theme</div>
      <div className="mt-2">
        <SegmentedControl
          options={[
            { value: 'light', label: 'Light', icon: <IconSun size={15} /> },
            { value: 'dark', label: 'Dark', icon: <IconMoon size={15} /> },
            { value: 'system', label: 'System' },
          ]}
          value={theme}
          onChange={setTheme}
        />
      </div>
      <div className="mt-5 flex gap-3">
        {SWATCHES.map((s) => (
          <div key={s.label} className="flex flex-col items-center gap-1">
            <div className={`h-10 w-10 rounded-sm border border-line ${s.className}`} />
            <span className="text-[11px] text-text-3">{s.label}</span>
          </div>
        ))}
      </div>

      <Branding />
    </section>
  );
}

function Branding() {
  const branding = useApp((s) => s.branding);
  const saveBranding = useApp((s) => s.saveBranding);
  const [name, setName] = useState(branding.productName);
  const [accent, setAccent] = useState(branding.accentColor);
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== branding.productName || accent !== branding.accentColor;

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await saveBranding({ productName: name.trim() || 'BaseDesk', accentColor: accent });
    } catch {
      toast('Could not save branding');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 border-t border-line pt-6">
      <h3 className="text-[13px] font-medium">Branding</h3>
      <p className="mt-0.5 text-[12px] text-text-3">The product name and accent color shown to your team and customers.</p>

      <label className="mt-4 block text-[13px] font-medium" htmlFor="brand-name">
        Product name
      </label>
      <input
        id="brand-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        placeholder="BaseDesk"
        className="mt-1.5 h-9 w-full max-w-xs rounded-sm border border-line bg-surface px-3 text-[14px] placeholder:text-text-3"
      />

      <div className="mt-4 text-[13px] font-medium">Accent color</div>
      <div className="mt-1.5 flex items-center gap-3">
        <input
          type="color"
          aria-label="Accent color"
          value={accent || '#4f46e5'}
          onChange={(e) => setAccent(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-sm border border-line bg-surface p-0.5"
        />
        <code className="text-[13px] text-text-2">{accent || 'Theme default'}</code>
        {accent !== '' && (
          <button type="button" onClick={() => setAccent('')} className="text-[13px] font-medium text-text-2 transition-colors hover:text-text">
            Reset to default
          </button>
        )}
      </div>

      <div className="mt-5">
        <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
          Save branding
        </Button>
      </div>
    </div>
  );
}
