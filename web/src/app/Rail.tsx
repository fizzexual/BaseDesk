import { useLocation, useNavigate } from 'react-router';
import { useApp } from '../data/store';
import { Avatar } from '../components/Avatar';
import { Menu } from '../components/Menu';
import { Tooltip } from '../components/Tooltip';
import {
  IconActivity,
  IconBook,
  IconChannels,
  IconChart,
  IconClipboard,
  IconContacts,
  IconHistory,
  IconInbox,
  IconLogo,
  IconLogOut,
  IconRevenue,
  IconSettings,
  IconSparkle,
  IconSun,
  IconUser,
} from '../icons';
import { cx } from '../components/util';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { to: '/view/all', label: 'Inbox', icon: IconInbox, matches: ['/view', '/ticket'] },
  { to: '/channels', label: 'Channels', icon: IconChannels, matches: ['/channels'] },
  { to: '/contacts', label: 'Contacts', icon: IconContacts, matches: ['/contacts'] },
  { to: '/revenue', label: 'Revenue', icon: IconRevenue, matches: ['/revenue'] },
  { to: '/ai', label: 'AI agents', icon: IconSparkle, matches: ['/ai'] },
  { to: '/reports', label: 'Reports', icon: IconChart, matches: ['/reports'] },
  { to: '/audit', label: 'Audit log', icon: IconHistory, matches: ['/audit'] },
  { to: '/handover', label: 'Handover', icon: IconClipboard, matches: ['/handover'] },
  { to: '/status', label: 'Status', icon: IconActivity, matches: ['/status'] },
  { to: '/kb', label: 'Knowledge', icon: IconBook, matches: ['/kb'] },
];

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} side="right">
      <button
        type="button"
        aria-label={label}
        className={cx(
          'inline-flex size-10 items-center justify-center rounded-md transition-colors',
          active ? 'bg-surface-3 text-text' : 'text-text-2 hover:bg-surface-2 hover:text-text',
        )}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function Rail() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const currentAgent = useApp((s) => s.agents[s.currentAgentId]);

  return (
    <nav aria-label="Primary" className="flex w-[60px] shrink-0 flex-col items-center gap-1 py-3">
      <button
        type="button"
        aria-label="BaseDesk home"
        className="mb-2 inline-flex size-10 items-center justify-center rounded-md text-text"
        onClick={() => navigate('/view/all')}
      >
        <IconLogo size={28} />
      </button>

      {NAV.map(({ to, label, icon: Icon, matches }) => (
        <RailButton
          key={to}
          label={label}
          active={matches.some((m) => pathname.startsWith(m))}
          onClick={() => navigate(to)}
        >
          <Icon size={20} />
        </RailButton>
      ))}

      <div className="flex-1" />

      <ThemeToggle />
      <RailButton
        label="Settings"
        active={pathname.startsWith('/settings')}
        onClick={() => navigate('/settings')}
      >
        <IconSettings size={20} />
      </RailButton>
      {currentAgent && (
        <Menu
          align="start"
          triggerLabel={`Account: ${currentAgent.name}`}
          triggerClassName="mt-1 rounded-full ring-offset-2 ring-offset-bg transition-shadow hover:ring-2 hover:ring-line-2"
          header={
            <div className="flex items-center gap-2.5">
              <Avatar name={currentAgent.name} hue={currentAgent.avatarHue} size={32} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-text">{currentAgent.name}</div>
                <div className="truncate text-[12px] capitalize text-text-3">{currentAgent.role}</div>
              </div>
            </div>
          }
          trigger={<Avatar name={currentAgent.name} hue={currentAgent.avatarHue} size={28} />}
          items={[
            { label: 'My profile', icon: <IconUser size={16} />, onSelect: () => navigate('/settings/profile') },
            { label: 'My team', icon: <IconContacts size={16} />, onSelect: () => navigate('/settings/team') },
            { separator: true },
            { label: 'Settings', icon: <IconSettings size={16} />, onSelect: () => navigate('/settings') },
            { label: 'Appearance', icon: <IconSun size={16} />, onSelect: () => navigate('/settings/appearance') },
            { separator: true },
            { label: 'Sign out', icon: <IconLogOut size={16} />, danger: true, onSelect: signOut },
          ]}
        />
      )}
    </nav>
  );
}

/**
 * BaseDesk admin is a single-operator, self-hosted tool with no separate login,
 * so "Sign out" just returns to a fresh session rather than clearing credentials.
 */
function signOut() {
  window.location.assign('/');
}
