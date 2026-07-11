import { SegmentedControl } from '../../components/SegmentedControl';
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
    </section>
  );
}
