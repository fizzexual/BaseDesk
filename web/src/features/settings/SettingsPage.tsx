import { NavLink, useParams } from 'react-router';
import { cx } from '../../components/util';
import { IconNote, IconSparkle, IconSun, IconUser } from '../../icons';
import { Profile } from './Profile';
import { Appearance } from './Appearance';
import { CannedReplies } from './CannedReplies';
import { AiSettings } from './AiSettings';

type TabId = 'profile' | 'appearance' | 'canned' | 'ai';

const TABS: Array<{
  id: TabId;
  label: string;
  icon: (p: { size?: number; className?: string }) => React.ReactNode;
}> = [
  { id: 'profile', label: 'Profile', icon: IconUser },
  { id: 'appearance', label: 'Appearance', icon: IconSun },
  { id: 'canned', label: 'Canned replies', icon: IconNote },
  { id: 'ai', label: 'AI', icon: IconSparkle },
];

export function SettingsPage() {
  const params = useParams<{ tab?: string }>();
  const tab: TabId =
    params.tab === 'appearance' || params.tab === 'canned' || params.tab === 'ai'
      ? params.tab
      : 'profile';

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-48 shrink-0 flex-col gap-1 border-r border-line p-3">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <NavLink
              key={t.id}
              to={`/settings/${t.id}`}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'flex h-8 items-center gap-2.5 rounded-md px-2 text-[14px] font-medium transition-colors',
                active ? 'bg-surface-3 text-text' : 'text-text-2 hover:bg-surface-2 hover:text-text',
              )}
            >
              <Icon size={17} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t.label}</span>
            </NavLink>
          );
        })}
      </nav>
      <div className="min-w-0 max-w-[560px] flex-1 overflow-y-auto p-6">
        {tab === 'profile' && <Profile />}
        {tab === 'appearance' && <Appearance />}
        {tab === 'canned' && <CannedReplies />}
        {tab === 'ai' && <AiSettings />}
      </div>
    </div>
  );
}
