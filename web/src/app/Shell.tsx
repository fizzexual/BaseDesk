import { Outlet, useNavigate } from 'react-router';
import { Rail } from './Rail';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Palette } from '../features/palette/Palette';
import { HelpOverlay } from '../features/palette/HelpOverlay';
import { ContextMenuHost } from '../components/ContextMenu';
import { openHelp, openPalette, useShortcuts } from '../features/palette/shortcuts';
import { useLiveSync } from './useLiveSync';

export function Shell() {
  const navigate = useNavigate();

  useLiveSync();

  useShortcuts('global', {
    'mod+k': openPalette,
    '?': openHelp,
    'g i': () => navigate('/view/all'),
    'g c': () => navigate('/contacts'),
    'g r': () => navigate('/reports'),
  });

  return (
    <div className="flex h-full w-full bg-bg">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1 pb-2.5 pr-2.5">
            <div className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-1">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      <Palette />
      <HelpOverlay />
      <ContextMenuHost />
    </div>
  );
}
