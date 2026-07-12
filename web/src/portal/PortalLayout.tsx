import { NavLink, Outlet, useNavigate } from 'react-router';
import { usePortal } from './store';
import { Avatar } from '../components/Avatar';
import { cx } from '../components/util';
import { IconLogo } from '../icons';

const NAV = [
  { to: '/portal', label: 'My tickets', end: true },
  { to: '/portal/new', label: 'New ticket', end: false },
  { to: '/portal/help', label: 'Help center', end: false },
];

export function PortalLayout() {
  const contact = usePortal((s) => s.contact);
  const logout = usePortal((s) => s.logout);
  const navigate = useNavigate();

  function onLogout() {
    logout();
    navigate('/portal/login');
  }

  return (
    <div className="flex min-h-full flex-col bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-4 px-4">
          <NavLink to="/portal" className="flex items-center gap-2 font-semibold">
            <IconLogo size={22} />
            <span>Support</span>
          </NavLink>
          <nav className="flex items-center gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx(
                    'rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                    isActive ? 'bg-surface-2 text-text' : 'text-text-2 hover:bg-surface-2 hover:text-text',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex-1" />
          {contact && (
            <NavLink to="/portal/profile" className="flex items-center gap-2" aria-label="Profile">
              <span className="hidden text-[13px] text-text-2 sm:block">{contact.name}</span>
              <Avatar name={contact.name} hue={contact.avatarHue} size={28} />
            </NavLink>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
