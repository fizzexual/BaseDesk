import { NavLink, Outlet, useNavigate } from 'react-router';
import { usePortal } from './store';
import { ThemeToggle } from './ThemeToggle';
import { Avatar } from '../components/Avatar';
import { Menu } from '../components/Menu';
import { cx } from '../components/util';
import { IconBook, IconChevronDown, IconInbox, IconLogo, IconPlus, IconUser } from '../icons';

type NavItem = { to: string; label: string; end: boolean; icon: (p: { size?: number; className?: string }) => React.ReactNode };

const NAV: NavItem[] = [
  { to: '/portal', label: 'My tickets', end: true, icon: IconInbox },
  { to: '/portal/new', label: 'New ticket', end: false, icon: IconPlus },
  { to: '/portal/help', label: 'Help center', end: false, icon: IconBook },
];

const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name;

function NavPill({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cx(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
          isActive ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-2 hover:text-text',
        )
      }
    >
      <Icon size={15} className="shrink-0" />
      {item.label}
    </NavLink>
  );
}

export function PortalLayout() {
  const contact = usePortal((s) => s.contact);
  const logout = usePortal((s) => s.logout);
  const navigate = useNavigate();

  function onLogout() {
    logout();
    navigate('/portal/login');
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-2 px-4 sm:px-6">
          <NavLink to="/portal" className="mr-1 flex shrink-0 items-center gap-2.5" aria-label="Support home">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
              <IconLogo size={18} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Support Center</span>
          </NavLink>

          <nav className="ml-2 hidden items-center gap-0.5 sm:flex">
            {NAV.map((item) => (
              <NavPill key={item.to} item={item} />
            ))}
          </nav>

          <div className="flex-1" />

          <ThemeToggle />

          {contact && (
            <Menu
              align="end"
              triggerLabel="Account menu"
              triggerClassName="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-surface-2"
              trigger={
                <>
                  <Avatar name={contact.name} hue={contact.avatarHue} size={28} />
                  <span className="hidden max-w-[10rem] truncate text-[13px] font-medium sm:block">
                    {firstName(contact.name)}
                  </span>
                  <IconChevronDown size={14} className="shrink-0 text-text-3" />
                </>
              }
              items={[
                { label: 'Your profile', icon: <IconUser size={15} />, onSelect: () => navigate('/portal/profile') },
                { separator: true },
                { label: 'Log out', danger: true, onSelect: onLogout },
              ]}
            />
          )}
        </div>

        {/* On narrow screens the nav drops to its own scrollable row. */}
        <nav className="flex items-center gap-0.5 overflow-x-auto border-t border-line px-3 py-2 sm:hidden">
          {NAV.map((item) => (
            <NavPill key={item.to} item={item} />
          ))}
        </nav>
      </header>

      <main className="w-full flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  );
}
