import { useApp } from '../data/store';
import { Menu } from '../components/Menu';
import { Tooltip } from '../components/Tooltip';
import { IconMoon, IconSun } from '../icons';

export function ThemeToggle() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const Icon = document.documentElement.dataset.theme === 'dark' ? IconMoon : IconSun;

  return (
    <Menu
      align="start"
      triggerLabel="Theme"
      triggerClassName="size-10 justify-center rounded-md text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
      trigger={
        <Tooltip label="Theme" side="right">
          <span className="inline-flex">
            <Icon size={20} />
          </span>
        </Tooltip>
      }
      items={[
        { label: 'Light', icon: <IconSun size={16} />, checked: theme === 'light', onSelect: () => setTheme('light') },
        { label: 'Dark', icon: <IconMoon size={16} />, checked: theme === 'dark', onSelect: () => setTheme('dark') },
        { label: 'System', checked: theme === 'system', onSelect: () => setTheme('system') },
      ]}
    />
  );
}
