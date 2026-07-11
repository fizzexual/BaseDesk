import { useLocation, useNavigate } from 'react-router';
import { useApp } from '../data/store';
import { Avatar } from '../components/Avatar';
import { Tooltip } from '../components/Tooltip';
import {
  IconChart,
  IconContacts,
  IconInbox,
  IconLogo,
  IconSettings,
  IconSparkle,
} from '../icons';
import { cx } from '../components/util';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { to: '/view/all', label: 'Inbox', icon: IconInbox, matches: ['/view', '/ticket'] },
  { to: '/contacts', label: 'Contacts', icon: IconContacts, matches: ['/contacts'] },
  { to: '/ai', label: 'AI agents', icon: IconSparkle, matches: ['/ai'] },
  { to: '/reports', label: 'Reports', icon: IconChart, matches: ['/reports'] },
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
        <button
          type="button"
          aria-label={`Signed in as ${currentAgent.name}`}
          className="mt-1"
          onClick={() => navigate('/settings')}
        >
          <Avatar name={currentAgent.name} hue={currentAgent.avatarHue} size={28} />
        </button>
      )}
    </nav>
  );
}
